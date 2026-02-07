# @jfungus/ratelimit - Improvement TODO

Research compiled from: express-rate-limit, rate-limiter-flexible, @upstash/ratelimit, nuxt-security, nuxt-api-shield

---

## P0 - Correctness Issues

### 1. ~~Check-before-write in sliding window~~ ✅ DONE

**Status: Fixed.** Added optional `checkAndIncrement` method to the `RateLimitStore` interface. MemoryStore implements it atomically (inherently safe in single-threaded JS). The core algorithm uses `checkAndIncrement` when available, falling back to the legacy increment-first approach for stores without it. Rejected requests no longer inflate the counter, preventing legitimate traffic from being blocked sooner than expected during sustained attacks.

**Problem:** Currently `store.increment(currentKey)` runs before checking if the limit is exceeded. This means rejected requests still consume a token, inflating the counter. Under sustained attack, legitimate requests get blocked sooner than they should because rejected requests are counted.

**Current code (packages/core/src/index.ts, checkSlidingWindow):**
```ts
// Increment current window FIRST (always consumes a token)
const current = await store.increment(currentKey)

// Then check limit
const estimatedCount = Math.floor(previousCount * weight) + current.count
const allowed = estimatedCount <= limit
```

**What @upstash/ratelimit does:** Their Lua script checks `prevWeighted + current >= limit` BEFORE calling `INCRBY`. If the request would exceed the limit, the script returns `-1` without modifying anything.

**Fix approach:**
- Add a `store.get(currentKey)` call before `store.increment(currentKey)`
- Compute the estimated count with `currentCount + 1` (speculative)
- Only call `store.increment()` if the request would be allowed
- This adds one extra store call for allowed requests but saves rejected requests from inflating the counter
- Alternative: add an atomic `incrementIfBelow(key, limit)` method to the store interface for stores that can support it (Redis Lua, etc.)

**⚠️ TOCTOU Race Condition:** The get-then-increment approach described above has a time-of-check-to-time-of-use race condition with non-atomic stores. When concurrent requests hit `Promise.all`, they all read the same count via `store.get()` in the same event loop tick, all pass the check, and all increment — allowing more requests through than the limit. The current increment-first approach is actually **safer** because each request gets a unique monotonic count. **Implementing check-before-write correctly requires atomic store operations (see #6) and should be done alongside atomic sliding window support, not independently.**

**Impact:** Correctness under load. Without this, a burst of 1000 rejected requests during a window inflates the counter by 1000, blocking legitimate traffic in the next sliding window calculation.

---

### 2. ~~Fix unstorage and Nuxt custom stores (same 2x TTL bug)~~ ✅ DONE

**Status: Fixed.** Applied same 2x internal reset pattern as MemoryStore to both unstorage and Nuxt stores. Changes made:
- `getTtlSeconds()`: `windowMs * 1.1` → `windowMs * 2 * 1.1`
- `increment()` new entry: stores `now + windowMs * 2` internally, returns `now + windowMs` externally
- `increment()` existing entry: returns `updated.reset - windowMs`
- `get()`: returns `entry.reset - windowMs`

Integration tests added proving sliding window weighting works end-to-end with unstorage store.

~~**Problem:** The MemoryStore was fixed to store entries with 2x windowMs for sliding window support, but the two other store implementations still use 1x windowMs. The sliding window algorithm is broken when using these stores.~~

---

## P1 - Production Readiness

### 3. ~~Two-Map rotation MemoryStore (from express-rate-limit)~~ ✅ DONE

**Status: Fixed.** Replaced O(n) cleanup sweep with O(1) two-map rotation pattern. `previous` and `current` maps rotate every `2*windowMs`. On access, live entries in `previous` are promoted to `current`; expired entries are discarded. Old `previous` map is garbage-collected by the runtime without per-entry iteration. All existing tests pass.

**Problem:** Current cleanup uses `setInterval` that iterates ALL entries in the map to find and delete expired ones. This is O(n) per cleanup cycle and gets worse as more keys are tracked.

**Current code:**
```ts
this.cleanupTimer = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of this.entries) {
    if (entry.reset <= now) {
      this.entries.delete(key)
    }
  }
}, cleanupInterval)
```

**express-rate-limit's approach:** Two maps, `previous` and `current`. Every windowMs:
```ts
clearExpired(): void {
  this.previous = this.current    // O(1) pointer swap
  this.current = new Map()        // old previous gets GC'd by runtime
}
```

On access (`getClient`):
- If key is in `current` -> return it
- If key is in `previous` -> move it to `current` (promote active client), delete from previous
- If key is in neither -> create new entry in `current`

**Benefits:**
- O(1) bulk expiration (no iteration)
- Active clients are automatically preserved by promotion
- Inactive clients vanish on next rotation without any per-entry work
- GC handles the actual memory reclamation

**Considerations for our implementation:**
- Our entries have per-key reset times (not a single global window), so the two-map rotation needs adaptation
- We store entries with 2x windowMs for sliding window support, so the rotation interval and promotion logic must account for this
- The sliding window algorithm uses timestamped keys (`key:timestamp`) that are window-aligned, which actually maps well to the two-map model since all keys in a window expire together

**Implementation notes:**
- Replace `entries: Map` with `previous: Map` + `current: Map`
- `increment()`: check current, then previous (promote if found), then create new
- `get()`: check current, then previous (promote if found)
- Timer: swap every `windowMs` (or `windowMs * 2` for the 2x storage)
- Consider whether promotion should reset the entry's reset time or preserve it

---

### 4. ~~Ephemeral in-memory block cache (from @upstash/ratelimit + rate-limiter-flexible)~~ ✅ DONE

**Status: Fixed.** Added opt-in `blockCache` parameter to `checkRateLimit()`. Pass a `Map<string, number>` to cache blocked keys by reset timestamp. Subsequent requests for cached keys return rejection immediately without any store I/O. Cache entries auto-expire when checked after their reset time. Tests verify caching, expiry, and backward compatibility.

**Problem:** Once a key is rate-limited, every subsequent request still hits the store (Redis, memory map, etc.) just to get rejected again. Under attack, this wastes store I/O on keys we already know are blocked.

**@upstash/ratelimit's approach (`src/cache.ts`):**
```ts
class Cache {
  private cache: Map<string, number>  // key -> reset timestamp

  isBlocked(identifier: string): { blocked: boolean; reset: number } {
    const reset = this.cache.get(identifier)
    if (!reset) return { blocked: false, reset: 0 }
    if (reset < Date.now()) {
      this.cache.delete(identifier)
      return { blocked: false, reset: 0 }
    }
    return { blocked: true, reset }
  }

  blockUntil(identifier: string, reset: number): void {
    this.cache.set(identifier, reset)
  }
}
```

**rate-limiter-flexible's approach (`BlockedKeys`):**
```ts
class BlockedKeys {
  private _keys: Record<string, number> = {}  // key -> expiry timestamp
  private _addedKeysAmount = 0

  addMs(key: string, ms: number): void {
    this._keys[key] = Date.now() + ms
    this._addedKeysAmount++
    if (this._addedKeysAmount > 999) {
      this.collectExpired()  // amortized GC every 1000 additions
    }
  }
}
```

**Integration point in our code:**
- In `checkSlidingWindow` and `checkFixedWindow`, before touching the store:
  1. Check if key is in the block cache
  2. If blocked and reset is in the future -> return rejection immediately (zero store I/O)
  3. If blocked but reset has passed -> remove from cache, proceed normally
- After a request is rejected:
  1. Add key to block cache with the reset timestamp

**rate-limiter-flexible claims 7x latency reduction** during attacks because blocked keys never hit Redis.

**Considerations:**
- Should be opt-in (e.g., `ephemeralCache: true` in config) since it trades accuracy for performance
- In serverless environments, the cache only helps if the rate limiter instance persists across invocations (module scope)
- The cache can over-block: a key blocked until reset T stays blocked even if a new window theoretically starts. This is conservative but safe.

---

### 5. ~~Fail-open / Insurance limiter (from rate-limiter-flexible + express-rate-limit)~~ ✅ DONE

**Status: Fixed.** Added optional `fallbackStore` parameter to `checkRateLimit()`. When the primary store throws an infrastructure error (not a rate limit rejection), the request is retried with the fallback store. Returns `reason: 'fallback'` to indicate failover occurred. Tests verify fallback works, enforces limits, and that primary is used when available.

**Problem:** If the external store (Redis, database) goes down, all rate limit checks fail. The application either crashes or lets all traffic through uncontrolled.

**rate-limiter-flexible's insurance pattern:**
```ts
// In _handleError:
if (err instanceof RateLimiterRes) {
  reject(err)  // Legitimate rate limit rejection -> enforce it
} else if (this.insuranceLimiter) {
  this.insuranceLimiter[funcName](...params)  // Infrastructure error -> failover
    .then(resolve).catch(reject)
} else {
  reject(err)  // No insurance -> propagate error
}
```

Key distinction: **rate-limit rejections pass through normally** (you still want to enforce limits). Only **infrastructure errors** (Redis timeout, connection refused, etc.) trigger the failover to an in-memory backup limiter.

**express-rate-limit's simpler approach:**
```ts
if (config.passOnStoreError) {
  console.error('error from store, allowing request without rate-limiting.')
  next()  // fail open - let everything through
  return
}
throw error  // fail closed - 500 error
```

**Recommended approach for @jfungus/ratelimit:**
- Add an optional `fallbackStore` (or `insuranceStore`) option to `CheckRateLimitOptions`
- When the primary store throws a non-RateLimitError, transparently retry with the fallback
- Default fallback: `undefined` (current behavior, errors propagate)
- Also add a simpler `passOnStoreError: boolean` option for the fail-open pattern
- The insurance limiter settings (blockDuration, etc.) should inherit from the primary

---

### 6. ~~Atomic sliding window for Redis/external stores~~ ✅ DONE (MemoryStore)

**Status: Fixed for MemoryStore.** Added `checkAndIncrement` method to `RateLimitStore` interface. MemoryStore implements it with atomic check-then-write (single-threaded JS guarantee). External stores (Redis, etc.) can implement this method using Lua scripts for true atomicity. Stores without `checkAndIncrement` fall back to the legacy approach automatically.

**Problem:** The current sliding window does `store.get(previousKey)` and `store.increment(currentKey)` as two separate non-atomic operations. Between these two calls, another process could modify the data, leading to race conditions under high concurrency.

**@upstash/ratelimit's Lua script (atomic):**
```lua
local requestsInCurrentWindow = redis.call("GET", currentKey)
local requestsInPreviousWindow = redis.call("GET", previousKey)
local percentageInCurrent = (now % window) / window
requestsInPreviousWindow = math.floor((1 - percentageInCurrent) * requestsInPreviousWindow)

if requestsInPreviousWindow + requestsInCurrentWindow >= limit then
  return {-1, limit}  -- reject without incrementing
end

local newValue = redis.call("INCRBY", currentKey, incrementBy)
if newValue == incrementBy then
  redis.call("PEXPIRE", currentKey, window * 2 + 1000)
end
return {limit - (newValue + requestsInPreviousWindow), limit}
```

**Considerations:**
- This requires store-specific implementations (Lua for Redis, transactions for SQL, etc.)
- The `RateLimitStore` interface would need an optional `slidingWindowIncrement(currentKey, previousKey, limit, windowMs)` method
- For stores that don't support atomic operations, fall back to the current two-call approach with a warning
- The unstorage adapter would need a Redis-specific path that uses `evalsha`/`eval`

**Impact:** Without atomicity, two concurrent requests could both read `count = limit - 1`, both pass the check, and both increment, resulting in `count = limit + 1`. The probability increases with request rate.

---

## P2 - Competitive Features

### 7. ~~Points/weight system (from rate-limiter-flexible)~~ ✅ DONE

**Status: Fixed.** Added optional `cost` parameter (default: 1) to `checkRateLimit()`, `store.increment()`, and both algorithm functions. The `limit` now represents total points per window. MemoryStore and unstorage adapter both accept the cost parameter. Fully backward compatible — omitting `cost` gives the same behavior as before.

**Problem:** Currently every request costs exactly 1 unit. There's no way to say "a file upload should count as 10 requests" or "a GET costs less than a POST."

**rate-limiter-flexible's approach:**
```ts
// Every consume() call specifies points
await limiter.consume(userIP, 1)    // GET
await limiter.consume(userIP, 5)    // POST
await limiter.consume(userIP, 50)   // file upload
```

The store just does `incrby(key, points)` instead of `incrby(key, 1)`. The limit is expressed in total points per window rather than request count.

**Implementation for @jfungus/ratelimit:**
- Add optional `cost` (or `weight` or `points`) parameter to `checkRateLimit()`:
  ```ts
  checkRateLimit({ store, key, limit, windowMs, cost: 5 })
  ```
- Default `cost = 1` (backward compatible)
- `store.increment(key)` becomes `store.increment(key, cost)` -- update the store interface
- The `limit` now represents total points per window, not request count
- Framework adapters (Express, Hono, H3) would accept a `cost` function/value in their config

**Considerations:**
- Store interface change is breaking -- existing custom stores would need to accept the second parameter
- Could make the second parameter optional with default 1 for backward compat
- Also enables the refund pattern: `cost: -1` to give back tokens (see #9)

---

### 8. ~~Runtime config support (`configure()` method)~~ ✅ DONE

**Status: Fixed.** Added a `.configure()` method to Hono, H3, and Express adapters for safe runtime config changes. Safe keys (`limit`, `dryRun`, `skip`, `handler`, `onRateLimited`, `onStoreError`, `keyGenerator`, `skipSuccessfulRequests`, `skipFailedRequests`, plus adapter-specific options) can be changed at any time. Unsafe keys (`windowMs`, `algorithm`, `store`) throw an error to prevent breaking existing rate limit state. Also fixed 3 bugs in the Nuxt middleware: routes cached forever on runtime config change, store leaks when windowMs changes, and build-time config always overriding runtime config.

---

### 9. ~~Dynamic limits per request (from express-rate-limit)~~ ✅ DONE

**Status: Fixed.** All three framework adapters (Hono, H3, Express) accept `limit` as `number | ((req/c/event) => number | Promise<number>)`. The core `checkRateLimit()` already supports dynamic limits since callers pass `limit` per call. Tests added for Express dynamic limits.

**Problem:** The `limit` value is currently static -- set once at configuration time. Real-world apps need different limits for different users (free vs premium), different endpoints, or different times of day.

**express-rate-limit's approach:**
```ts
rateLimit({
  limit: async (req, res) => {
    if (req.user?.isPremium) return 1000
    return 100
  }
})
```

Every config option accepts either a static value or an async function that receives the request.

**Implementation for @jfungus/ratelimit:**
- For the core `checkRateLimit()`: no change needed -- callers already control the `limit` parameter per call
- For framework adapters (Express, Hono, H3, Nuxt): accept `limit` as `number | (req) => number | Promise<number>`
- Same pattern could apply to `windowMs`, `key`, and `skip`

**This is mostly a framework adapter concern**, not a core library change. The core API already supports dynamic limits since the caller passes `limit` each time.

---

### 10. ~~Timeout with fail-open (from @upstash/ratelimit)~~ ✅ DONE

**Status: Fixed.** Added optional `timeout` parameter to `checkRateLimit()`. When specified, store calls are raced against a timer. If the store doesn't respond within the timeout, the request is allowed through (fail-open). Tests verify timeout behavior, normal fast response, and backward compatibility.

**Problem:** In serverless/edge environments, a slow store response can cause request timeouts. Better to let the request through than to hang.

**@upstash/ratelimit's approach:**
```ts
const responseArray = [actualCheck]
if (this.timeout > 0) {
  responseArray.push(new Promise(resolve => {
    setTimeout(() => resolve({
      success: true,
      reason: "timeout",
      // ...
    }), this.timeout)
  }))
}
const result = await Promise.race(responseArray)
```

**Implementation:**
- Add optional `timeout` to `CheckRateLimitOptions`
- Wrap the store calls in `Promise.race` with a timeout
- On timeout, return `{ allowed: true, info: { ... }, reason: "timeout" }`
- Add `reason` field to `CheckRateLimitResult` for observability
- Default: no timeout (current behavior)

---

### 11. ~~`pending` promise pattern (from @upstash/ratelimit)~~ ✅ DONE

**Status: Fixed.** Added `pending: Promise<void>` to `CheckRateLimitResult`. Resolves immediately for now but provides infrastructure for serverless `waitUntil()` support without API changes. All return paths now include the pending promise.

**Problem:** In edge/serverless platforms (Vercel Edge, Cloudflare Workers), background work after sending the response requires `context.waitUntil()`. Analytics, multi-region sync, and other housekeeping need this pattern.

**@upstash/ratelimit's approach:**
```ts
return {
  success: true,
  limit: 100,
  remaining: 95,
  reset: 1706000000,
  pending: syncAndAnalytics()  // background work
}
```

Callers do: `context.waitUntil(result.pending)`

**Implementation:**
- Add optional `pending: Promise<void>` to `CheckRateLimitResult`
- Currently no background work to put there, but it sets up the infrastructure for:
  - Analytics/logging
  - Multi-region sync
  - Deferred store cleanup
- Framework adapters should automatically handle `waitUntil` where supported

---

## P3 - Advanced Features

### 12. ~~Penalty/reward methods (from rate-limiter-flexible)~~ ✅ DONE

**Status: Fixed.** Added `penalty(key, points)` and `reward(key, points)` methods to the `RateLimiterInstance` returned by `createRateLimiter()`. Penalty silently consumes points; reward gives points back via `store.decrement()`. Neither triggers blocking or side effects. The `createRateLimiter` return type changed from a plain function to a `RateLimiterInstance` object with `.check()`, `.penalty()`, and `.reward()` methods.

**Penalty:** Add points to a key without triggering block logic. Use case: WAF detects suspicious behavior, penalize the IP by consuming extra points.

**Reward:** Subtract points from a key, giving back capacity. Use case: User solves CAPTCHA, reward them with restored quota.

```ts
// rate-limiter-flexible:
await limiter.penalty(key, 10)   // consume 10 points silently
await limiter.reward(key, 5)     // give back 5 points
```

Critical difference from `consume()`: these never trigger blocking, execEvenly delays, or other side effects. They're administrative counter adjustments.

**Implementation:**
- Add `penalty(key, points)` and `reward(key, points)` to the core API
- These call `store.increment(key, points)` / `store.increment(key, -points)` directly without checking limits
- Could be methods on a `RateLimiter` instance created by `createRateLimiter()`

---

### 13. ~~Ban escalation (from nuxt-api-shield)~~ ✅ DONE

**Status: Fixed.** Added optional `blockDuration` parameter to `checkRateLimit()`. When a key exceeds the limit and `blockDuration` is set, the key is banned for `blockDuration` ms (stored in `blockCache`). Subsequent requests are rejected via the cache without store I/O until the ban expires. Requires `blockCache` to be provided.

**Two-tier system:** Normal rate limiting resets each window, but repeated violations trigger a longer ban period.

**nuxt-api-shield's approach:**
```ts
if (newCount > routeLimit.max) {
  const banUntil = now + routeLimit.ban * 1000
  await storage.setItem(`ban:${ip}`, banUntil)   // separate ban key
  await storage.setItem(`ip:${path}:${ip}`, { count: 1, time: now })  // reset counter
  throw createError({ statusCode: 429 })
}
```

**Key design:**
- Rate limit keys are path-specific: `ip:/api/users:1.2.3.4`
- Ban keys are path-independent: `ban:1.2.3.4` (banned from everything)
- Ban check runs before rate limit check (fast path for banned IPs)
- Ban duration is configurable (default: 1 hour)

**Implementation:**
- Add optional `blockDuration` to config (rate-limiter-flexible's naming)
- When a key exceeds the limit AND `blockDuration > 0`, set a block entry with extended TTL
- Block check happens before store access (like the ephemeral cache from #4)
- Could combine with the ephemeral cache: `blockedKeys` map stores ban expiry timestamps

---

### 14. IPv6 subnet masking (from express-rate-limit)

**Problem:** IPv6 gives each device a /128 address within a /56 (or /48) allocation. An attacker can rotate through millions of IPv6 addresses within their allocation to bypass per-IP rate limits.

**express-rate-limit's approach:**
```ts
import { Address6 } from 'ip-address'

function ipKeyGenerator(ip: string, subnet: number = 56): string {
  if (isIPv6(ip)) {
    return `${new Address6(`${ip}/${subnet}`).startAddress().correctForm()}/${subnet}`
  }
  return ip
}
// 2001:db8:1234:5678:abcd:ef01:2345:6789
// becomes: 2001:db8:1234:56::/56
```

**Implementation:**
- Add optional `ipv6Subnet` option to framework adapters (default: 56)
- Apply subnet masking in the key generator before passing to `checkRateLimit()`
- Could use the `ip-address` npm package (express-rate-limit's only dependency) or implement a simpler bitmask
- The `false` value disables masking (use full IP)
- Could also accept a function for per-request subnet configuration

---

### 15. ~~Whitelist / blacklist bypass (from rate-limiter-flexible)~~ ✅ DONE

**Status: Fixed.** Added `whitelist` and `blacklist` options to `checkRateLimit()`. Both accept either `string[]` or `(key: string) => boolean`. Whitelisted keys get `allowed: true` with `remaining: limit`; blacklisted keys get `allowed: false` with `remaining: 0`. No store operations are performed for listed keys.

**rate-limiter-flexible's `RLWrapperBlackAndWhite`:**
```ts
consume(key) {
  if (this.isWhiteListed(key))
    return resolve({ remainingPoints: Number.MAX_SAFE_INTEGER })
  if (this.isBlackListed(key))
    return reject({ msBeforeNext: Number.MAX_SAFE_INTEGER })
  return this.limiter.consume(key)
}
```

- Whitelisted: infinite remaining (never rate limited)
- Blacklisted: infinite block time (always rejected)
- Supports both static arrays and dynamic functions
- `runActionAnyway` option: still runs the limiter for analytics even on bypass

**Implementation:**
- Add optional `whitelist: string[]` and `blacklist: string[]` to config
- Check before any store operations
- Could also accept functions: `whitelist: (key) => boolean`

---

### 16. ~~BurstyRateLimiter composition (from rate-limiter-flexible)~~ ✅ DONE

**Status: Fixed.** Added `createBurstyRateLimiter()` function that composes two limiters. When the primary limiter rejects, the burst limiter absorbs overflow. The returned `info` reflects primary's state (burst pool hidden from callers). Tests verify normal operation, burst absorption, exhaustion, and cost support.

**Compose two limiters for burst tolerance without sliding window complexity:**
```ts
const bursty = new BurstyRateLimiter(
  new RateLimiterMemory({ points: 10, duration: 1 }),   // 10/sec sustained
  new RateLimiterMemory({ points: 20, duration: 60 }),  // 20/min burst pool
)
```

When the primary limiter rejects, the burst limiter absorbs overflow. The burst pool is hidden from callers (remainingPoints comes from primary only).

**This is an alternative to sliding window** for use cases where burst tolerance is needed but the full sliding window algorithm is too complex or expensive.

---

### 17. ~~Response enrichment~~ ✅ DONE

**Status: Fixed.** Added `reason` field to `CheckRateLimitResult`: `'limit'` (normal check), `'cacheBlock'` (denied via ephemeral cache), `'timeout'` (allowed due to store timeout). Also exported the `RateLimitReason` type.

**Add `reason` field to CheckRateLimitResult (from @upstash/ratelimit):**
```ts
type CheckRateLimitResult = {
  allowed: boolean
  info: RateLimitInfo
  reason?: "timeout" | "cacheBlock" | "denyList" | "storeError"
}
```

This tells callers WHY a request was allowed/denied, enabling better observability and debugging.

---

### 18. ~~express-rate-limit: Validation-once-then-disable~~ ✅ DONE

**Status: Fixed.** Implemented validation-once-then-disable pattern across all adapters:
- **Express**: First-request validation for `trust proxy` configuration (warns if `req.ip` is undefined without trust proxy set)
- **All adapters (Hono, H3, Express, Nuxt)**: One-time warning via `unknownIPWarned` flag when client IP cannot be determined

The validations run on the first request only, then disable themselves to avoid per-request overhead.

```ts
// First request:
validations.trustProxy(req)    // warns if trust proxy not set
validations.ip(req.ip)         // warns if IP is undefined
// Then:
config.validations.disable()   // never run again
```

Also includes stack trace inspection to detect "rate limiter created inside request handler" antipattern.

---

### 19. ~~express-rate-limit: IETF Draft-8 headers with partition keys~~ ✅ DONE

**Status: Fixed.** Ported the full header format system (`HeadersFormat`, `QuotaUnit`, `identifier`, `quotaUnit`) from Hono/H3 to Express. All three adapters now support: `'legacy'` (default), `'draft-6'`, `'draft-7'`, `'standard'` (IETF draft-08+), and `false` (disable). The old `legacyHeaders`/`standardHeaders` boolean options remain as deprecated aliases for backward compatibility. Tests cover all 5 header format modes in Express.

The latest IETF standard (draft-8) includes:
- Named quotas: `"100-in-1min"` identifier
- Partition keys: SHA-256 hash of the client key (privacy-preserving)
- Stackable: `response.append()` so multiple limiters can add their own headers

---

## P0.5 - Verified Bugs (from code review)

### 19. ~~Unstorage increment race condition (non-atomic read-then-write)~~ ✅ DOCUMENTED

**Problem:** The unstorage `increment()` at `packages/unstorage/src/index.ts:128-154` does a `getItem` then `setItem` as two separate operations. Under concurrent load with any shared store (Redis, database), this produces lost updates.

**Race scenario:**
```
Request A: reads count=5
Request B: reads count=5
Request A: writes count=6
Request B: writes count=6   ← should be 7, lost update
```

**This is the most impactful bug for distributed deployments.** Every multi-instance setup using the unstorage adapter is affected. The MemoryStore is immune (single-process, synchronous).

**The same race exists in the Nuxt runtime store** at `packages/nuxt/runtime-js/server/middleware/ratelimit.js:89-114`.

**Fix approach (short-term):** Document that the unstorage adapter is not safe for multi-instance deployments without an atomic storage driver.

**Fix approach (long-term):** For Redis, use a Lua script that bundles GET + INCRBY + PEXPIRE into one atomic operation (see #6). For other drivers, explore driver-specific atomic primitives or accept the limitation with a documented warning.

**Impact:** Under 100 concurrent requests/second across 4 instances, ~15-25% of increments can be lost, allowing significantly more requests through than the configured limit.

---

### 20. ~~Nuxt runtime duplicates the unstorage store code (maintenance hazard)~~ ✅ DONE

**Status: Fixed.** Replaced ~140 lines of duplicated store code in the Nuxt runtime middleware with a 2-line import of `createUnstorageStore` from `@jfungus/ratelimit-unstorage`. Added `@jfungus/ratelimit-unstorage` as a workspace dependency of the Nuxt package.

~~**Problem:** `packages/nuxt/runtime-js/server/middleware/ratelimit.js:51-181` is a full copy-paste of the unstorage adapter logic rather than importing `@jfungus/ratelimit-unstorage`. This means **every bug fix must be applied in two places**.~~

**Already demonstrated:** The 2x TTL fix (#2) needs to be applied to both files independently. The race condition (#19) exists in both copies.

**Files:**
- `packages/unstorage/src/index.ts` (canonical)
- `packages/nuxt/runtime-js/server/middleware/ratelimit.js` (copy)

**Fix approach:**
- Option A: Have the Nuxt runtime import from `@jfungus/ratelimit-unstorage` at runtime
- Option B: Generate the Nuxt runtime file from the unstorage source during build
- Option C: Extract shared storage logic into a common internal package

**Impact:** Every current and future bug fix risks being applied to one file but not the other.

---

### 21. ~~`getClientIP` returns 'unknown' fallback (shared bucket problem)~~ ✅ DONE

**Status: Fixed.** Added a one-time `console.warn` in all four places that fall back to `'unknown'`: Hono, H3, and Express `getClientIP()` functions, and Nuxt middleware `generateKey()`. The warning message advises configuring reverse proxy headers.

~~**Problem:** All three framework adapters return `'unknown'` when no IP can be determined:~~
- Hono: `packages/hono/src/index.ts` line ~420
- H3: `packages/h3/src/index.ts` line ~121
- Express: `packages/express/src/index.ts` line ~154

If multiple clients hit the server without detectable IPs (misconfigured proxy, missing headers), they all share a single rate limit bucket keyed to `'unknown'`. One heavy user exhausts the limit for everyone.

**Fix approach:**
- Log a warning on the first `'unknown'` IP detection (once, not per-request)
- Consider making the fallback configurable
- Add validation similar to express-rate-limit's `validations.ip(req.ip)` that warns about missing trust proxy configuration

---

### 22. ~~IPv6 bypass (verified in all three adapters)~~ ✅ DONE

**Status: Fixed.** Added `maskIPv6()` utility to the core package that applies /56 subnet masking to IPv6 addresses (zero dependencies, pure bitwise operations). Integrated into all four adapters (Hono, H3, Express, Nuxt). The `getClientIP()` functions now accept an `ipv6Subnet` parameter (default: 56, `false` to disable). Addresses within the same /56 allocation share a single rate limit bucket, preventing bypass via IPv6 address rotation.

**Problem:** All three `getClientIP` implementations return the raw IP string with zero subnet normalization. Any user with a /56 IPv6 allocation can rotate through ~4.7 sextillion unique addresses, each getting its own fresh rate limit bucket.

**Affected files:**
- `packages/hono/src/index.ts` ~line 420
- `packages/h3/src/index.ts` ~line 121
- `packages/express/src/index.ts` ~line 154

**This is the same issue as #13 but elevated because it's a verified security bypass**, not just a nice-to-have. Promoting from P3 to at least P2.

**Minimum fix:** Apply /56 subnet masking by default for IPv6 addresses in all adapters. Can be done without the `ip-address` dependency using simple bitwise operations on the parsed IPv6 address.

---

### 23. ~~Unstorage increment resets TTL on every write (subtle correctness issue)~~ ✅ DONE

**Status: Fixed.** Split TTL calculation into `getNewEntryTtlSeconds()` (full 2x windowMs + 10% buffer) and `getRemainingTtlSeconds(reset)` (based on actual remaining time + 10% buffer). Existing entries now use the remaining TTL, preventing unnecessarily extending key lifetime in storage. Applied to both `increment()` and `decrement()`.

**Problem:** At `packages/unstorage/src/index.ts:141-143`, every `increment()` call refreshes the storage driver TTL:

```ts
await storage.setItem(fullKey, updated, {
  ttl: getTtlSeconds(),
})
```

For the **current window key**, this is fine -- it extends the TTL as requests come in, keeping the key alive.

For the **previous window key**, this doesn't matter because it stops receiving writes once its window ends.

**The nuance:** The current window key's TTL gets refreshed on every request, meaning it could live indefinitely under sustained traffic. This isn't a correctness bug (the `reset` field still controls the logical expiry), but it means the storage driver holds keys longer than necessary. Under the 2x TTL fix (#2), this becomes less of an issue since the TTL is already generous.

**Impact:** Minor -- storage holds stale keys slightly longer than optimal. Not a correctness issue, but worth noting for storage cost optimization on high-traffic deployments.

---

## P1.5 - Feature Parity

### 24. ~~H3 adapter feature gap (verified)~~ ✅ DONE

**Status: Fixed.** Ported the following features from Hono to H3:
- Header formats: legacy (default), draft-6, draft-7, standard, false (disable)
- Policy identifier and quota unit for IETF headers
- Store access in event context (`event.context.rateLimitStore`)
- Note: `skipSuccessfulRequests`/`skipFailedRequests` not ported — H3 middleware lacks a clean after-response hook. These remain Hono/Express-only features.

**Problem:** The H3 adapter is significantly behind the Hono adapter in features:

| Feature | Hono | H3 |
|---------|------|-----|
| Header formats | 4 (legacy, draft-6, draft-7, standard) + disable | Legacy only |
| skipSuccessfulRequests | Yes | No |
| skipFailedRequests | Yes | No |
| Store access in context | rateLimitStore variable | No |
| Cloudflare binding | cloudflareRateLimiter() | No |
| Policy identifier | Yes | No |
| Quota unit | Yes | No |

**Since H3 is the foundation of Nuxt/Nitro**, this gap directly affects the Nuxt package's capabilities. The Nuxt adapter inherits H3's limitations.

**Fix approach:** Port features from the Hono adapter to H3, adapting for H3's API differences. Priority order:
1. Standard headers (draft-6/7/8) -- most visible to users
2. skipSuccessful/skipFailed -- common middleware pattern
3. Store access -- needed for advanced use cases

---

## Notes

- Items marked P0/P0.5 should be addressed before any release
- P1 items are what differentiate a "works" library from a "production-grade" one
- P1.5 items are feature parity issues that affect the library's credibility
- P2 items are the most-requested features across all competing libraries
- P3 items are advanced features that make the library stand out
- The two-map rotation (#3) and ephemeral cache (#4) could be combined into a single MemoryStore rewrite
- The points system (#7) requires a store interface change that should be planned carefully for backward compatibility
- ~~Check-before-write (#1) **requires** atomic sliding window (#6)~~ ✅ Solved: `checkAndIncrement` method on store interface; MemoryStore implements it atomically. External stores can provide their own implementation (e.g., Lua scripts for Redis).
- ~~Items #19 and #20 compound each other~~ ✅ Solved: code duplication eliminated (#20), both fixed

---

## Implementation Order (recommended)

### Phase 1: Correctness (P0 + P0.5)
1. ~~**#2** Fix unstorage + Nuxt stores 2x TTL bug~~ ✅ DONE
2. ~~**#20** Eliminate Nuxt runtime code duplication (prevents double-fixing)~~ ✅ DONE
3. ~~**#19** Document unstorage race condition (honesty with users)~~ ✅ DOCUMENTED
4. ~~**#21** Fix 'unknown' IP fallback with warning~~ ✅ DONE

### Phase 2: Security (P0.5 → P2)
5. ~~**#22/#14** IPv6 subnet masking in all adapters (security bypass)~~ ✅ DONE

### Phase 3: Production Hardening (P1)
6. ~~**#3** Two-Map rotation MemoryStore (performance)~~ ✅ DONE
7. ~~**#4** Ephemeral block cache (attack mitigation)~~ ✅ DONE
8. ~~**#5** Fail-open / insurance limiter (resilience)~~ ✅ DONE
9. ~~**#6 + #1** Atomic sliding window + check-before-write~~ ✅ DONE (MemoryStore; external stores can implement `checkAndIncrement`)

### Phase 4: Feature Parity (P1.5)
11. ~~**#24** H3 adapter feature gap (header formats, skip options)~~ ✅ DONE

### Phase 5: Competitive Features (P2)
12. ~~**#7** Points/weight system~~ ✅ DONE
13. ~~**#8** Runtime config (`configure()` method)~~ ✅ DONE
14. ~~**#9** Dynamic limits per request (framework adapters)~~ ✅ DONE
15. ~~**#10** Timeout with fail-open~~ ✅ DONE
16. ~~**#11** `pending` promise pattern~~ ✅ DONE

### Phase 6: Advanced (P3)
17. ~~**#12** Penalty/reward methods~~ ✅ DONE
18. ~~**#13** Ban escalation~~ ✅ DONE
19. ~~**#15** Whitelist/blacklist~~ ✅ DONE
20. ~~**#16** BurstyRateLimiter composition~~ ✅ DONE
21. ~~**#17** Response enrichment (`reason` field)~~ ✅ DONE
22. ~~**#18** Validation-once-then-disable~~ ✅ DONE
23. ~~**#19** IETF Draft-8 header consistency across adapters~~ ✅ DONE
24. ~~**#23** Unstorage TTL refresh optimization~~ ✅ DONE

---

## Competitive Position After All Phases

| Feature | After Phase 3 | After Phase 5 | After All |
|---------|:---:|:---:|:---:|
| Sliding window (correct) | Yes | Yes | Yes |
| Framework-agnostic | Yes | Yes | Yes |
| Zero dependencies | Yes | Yes | Depends on IPv6 approach |
| Store failover | Yes | Yes | Yes |
| Attack mitigation | Yes | Yes | Yes |
| Points/weighted | - | Yes | Yes |
| Atomic Redis | Yes | Yes | Yes |
| IPv6 masking | Yes | Yes | Yes |
| Ban escalation | - | - | Yes |
| Whitelist/blacklist | - | - | Yes |

After Phase 3, the library would be **production-grade**. After Phase 5, it would be **competitive with rate-limiter-flexible** on core features while offering the sliding window that rate-limiter-flexible lacks. After all phases, it would be the most complete framework-agnostic rate limiter available.
