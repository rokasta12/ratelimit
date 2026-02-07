/**
 * @jfungus/ratelimit - Framework-agnostic rate limiting library
 *
 * @module
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Rate limit information for a single request
 */
export type RateLimitInfo = {
  /** Maximum requests allowed in window */
  limit: number
  /** Remaining requests in current window */
  remaining: number
  /** Unix timestamp (ms) when window resets */
  reset: number
}

/**
 * Result from store increment/get operations.
 *
 * **Important for custom store implementors:** The `reset` value returned to
 * callers must be the *logical* (1x windowMs) reset time, even though stores
 * must internally persist entries with 2x windowMs for sliding window support.
 * See {@link RateLimitStore.increment} for details.
 */
export type StoreResult = {
  /** Current request count in window */
  count: number
  /** When the window resets (Unix timestamp ms). Must be the logical 1x reset time. */
  reset: number
}

/**
 * Rate limit algorithm
 */
export type Algorithm = 'fixed-window' | 'sliding-window'

/**
 * Store interface for rate limit state.
 *
 * Implement this interface to create custom storage backends.
 * The store is responsible for tracking request counts per key.
 *
 * **2x windowMs contract:** Stores must internally persist entries with a TTL/reset
 * of `2 * windowMs` so the sliding window algorithm can read the previous window's
 * count. However, the `StoreResult.reset` value returned to callers must be the
 * *logical* 1x reset time (`now + windowMs` for new entries, `internalReset - windowMs`
 * for existing entries). See {@link MemoryStore} for the canonical implementation.
 */
export type RateLimitStore = {
  /**
   * Initialize store. Called once before first use.
   * @param windowMs - Window duration in milliseconds
   */
  init?: (windowMs: number) => void | Promise<void>

  /**
   * Increment counter for key and return current state.
   * This is the main operation - it should atomically increment and return.
   *
   * **2x windowMs contract:** New entries must be stored with an internal reset of
   * `now + windowMs * 2`, but the returned `StoreResult.reset` must be `now + windowMs`.
   * Existing entries return `internalReset - windowMs`. This ensures the sliding window
   * algorithm can read the previous window's count after the logical window expires.
   *
   * @param key - Unique identifier for the rate limit bucket
   * @param cost - Number of points to consume (default: 1). Used for weighted rate limiting.
   */
  increment: (key: string, cost?: number) => StoreResult | Promise<StoreResult>

  /**
   * Decrement counter for key.
   * Used for skip options (skipSuccessfulRequests, skipFailedRequests).
   * @param key - Unique identifier for the rate limit bucket
   */
  decrement?: (key: string) => void | Promise<void>

  /**
   * Reset a specific key.
   * @param key - Unique identifier to reset
   */
  resetKey: (key: string) => void | Promise<void>

  /**
   * Reset all keys.
   */
  resetAll?: () => void | Promise<void>

  /**
   * Get current state for key.
   * Returns undefined if key doesn't exist or has expired.
   * Required for sliding window algorithm.
   *
   * **2x windowMs contract:** The returned `StoreResult.reset` must be the logical
   * 1x reset time (`internalReset - windowMs`), matching what `increment()` returns.
   *
   * @param key - Unique identifier for the rate limit bucket
   */
  get?: (key: string) => Promise<StoreResult | undefined> | StoreResult | undefined

  /**
   * Atomic check-and-increment for rate limiting.
   *
   * When implemented, the core algorithm uses this instead of separate
   * `increment()` + limit check. This prevents rejected requests from
   * inflating the counter (the "check-before-write" optimization).
   *
   * **For MemoryStore:** Inherently atomic because JavaScript is single-threaded.
   *
   * **For Redis:** Implement using a Lua script that bundles GET + limit check +
   * INCRBY into a single atomic operation to prevent TOCTOU race conditions.
   *
   * **For stores without atomic support:** Omit this method. The algorithm falls
   * back to the current `increment()` approach (which is still correct for
   * single-instance deployments but allows rejected requests to inflate counters).
   *
   * @param options - Atomic check parameters
   * @returns Result with whether the request is allowed and the current count
   */
  checkAndIncrement?: (options: {
    /** Current window key */
    currentKey: string
    /** Previous window key (for sliding window) */
    previousKey?: string
    /** Maximum allowed count */
    limit: number
    /** Window duration in milliseconds */
    windowMs: number
    /** Points to consume (default: 1) */
    cost?: number
  }) => Promise<StoreCheckResult> | StoreCheckResult

  /**
   * Graceful shutdown.
   * Clean up timers, connections, etc.
   */
  shutdown?: () => void | Promise<void>
}

/**
 * Result from atomic checkAndIncrement operation.
 */
export type StoreCheckResult = {
  /** Whether the request is allowed (estimated count <= limit) */
  allowed: boolean
  /**
   * Current window count including the request's cost.
   *
   * Always reflects `existingCount + cost`, regardless of whether the request was
   * allowed. This ensures callers can compute `remaining = max(0, limit - estimated)`
   * consistently (yielding 0 for denied requests).
   *
   * **Note:** For denied requests, the counter was NOT actually incremented in the store.
   * This value is hypothetical — it represents what the count *would be* if the request
   * were allowed.
   */
  count: number
  /** When the window resets (Unix timestamp ms). Must be the logical 1x reset time. */
  reset: number
  /** Previous window's count (for sliding window info calculation). 0 if not applicable. */
  previousCount?: number
}

/**
 * Options for checkRateLimit function
 */
export type CheckRateLimitOptions = {
  /** Storage backend for rate limit state */
  store: RateLimitStore
  /** Unique identifier for the client/request */
  key: string
  /** Maximum requests allowed in window */
  limit: number
  /** Window duration in milliseconds */
  windowMs: number
  /** Rate limiting algorithm (default: 'sliding-window') */
  algorithm?: Algorithm
  /**
   * Keys that should never be rate limited.
   *
   * Whitelisted keys immediately return `allowed: true` with `remaining: limit`
   * without any store operations.
   *
   * @default undefined
   */
  whitelist?: string[] | ((key: string) => boolean)
  /**
   * Keys that should always be rejected.
   *
   * Blacklisted keys immediately return `allowed: false` with `remaining: 0`
   * without any store operations.
   *
   * @default undefined
   */
  blacklist?: string[] | ((key: string) => boolean)
  /**
   * Number of points consumed by this request.
   *
   * When using the points/weight system, the `limit` represents total points
   * per window (not request count). Each request consumes `cost` points.
   *
   * @default 1
   *
   * @example
   * ```ts
   * // GET costs 1 point, POST costs 5 points
   * await checkRateLimit({ store, key, limit: 100, windowMs: 60_000, cost: 5 })
   * ```
   */
  cost?: number
  /**
   * Timeout in milliseconds for store operations.
   *
   * If the store doesn't respond within this time, the request is allowed
   * through (fail-open). Useful in serverless/edge environments where a
   * slow store response could cause request timeouts.
   *
   * @default undefined (no timeout)
   *
   * @example
   * ```ts
   * const result = await checkRateLimit({
   *   store, key, limit: 100, windowMs: 60_000,
   *   timeout: 5000, // Allow through if store takes > 5s
   * })
   * ```
   */
  timeout?: number
  /**
   * Duration in milliseconds to ban a key after it exceeds the limit.
   *
   * When set, a rate-limited key is blocked for `blockDuration` instead of
   * just until the current window resets. Requires `blockCache` to be provided.
   * The ban entry is stored in the block cache with the extended expiry.
   *
   * @default undefined (no ban escalation — blocked only until window reset)
   *
   * @example
   * ```ts
   * const blockCache = new Map<string, number>()
   * await checkRateLimit({
   *   store, key, limit: 5, windowMs: 60_000,
   *   blockCache,
   *   blockDuration: 3600_000, // Ban for 1 hour after exceeding limit
   * })
   * ```
   */
  blockDuration?: number
  /**
   * Ephemeral block cache for short-circuiting store lookups.
   *
   * When a key is rate-limited, it's cached in this map until its reset time.
   * Subsequent requests for that key return a rejection immediately without
   * touching the store, reducing I/O under sustained attack.
   *
   * Pass a shared `Map<string, number>` instance (key → reset timestamp).
   * The same map should be reused across calls. The cache is automatically
   * cleaned on access (expired entries are removed when checked).
   *
   * @default undefined (no caching)
   *
   * @example
   * ```ts
   * const blockCache = new Map<string, number>()
   *
   * const result = await checkRateLimit({
   *   store, key, limit: 100, windowMs: 60_000,
   *   blockCache,
   * })
   * ```
   */
  blockCache?: Map<string, number>
  /**
   * Fallback store for fail-open resilience.
   *
   * If the primary store throws an error (not a rate limit rejection, but an
   * infrastructure error like connection refused), the request is retried with
   * this backup store. If no fallback is provided and the primary fails, the
   * error is propagated.
   *
   * Common pattern: use MemoryStore as fallback for Redis/external stores.
   *
   * @default undefined (no fallback — errors propagate)
   *
   * @example
   * ```ts
   * const redisStore = createRedisStore({ ... })
   * const fallbackStore = new MemoryStore()
   * fallbackStore.init(60_000)
   *
   * await checkRateLimit({
   *   store: redisStore,
   *   fallbackStore,
   *   key, limit: 100, windowMs: 60_000,
   * })
   * ```
   */
  fallbackStore?: RateLimitStore
}

/**
 * Reason why a request was allowed or denied.
 *
 * - `'limit'`: Normal rate limit check (allowed or denied based on count vs limit)
 * - `'cacheBlock'`: Denied via ephemeral block cache (no store I/O)
 * - `'timeout'`: Allowed because the store didn't respond within the timeout
 * - `'fallback'`: Processed using fallback store after primary store error
 */
export type RateLimitReason = 'limit' | 'cacheBlock' | 'timeout' | 'fallback'

/**
 * Result from checkRateLimit function
 */
export type CheckRateLimitResult = {
  /** Whether the request is allowed */
  allowed: boolean
  /** Rate limit information */
  info: RateLimitInfo
  /** Why the request was allowed/denied */
  reason: RateLimitReason
  /**
   * Background work that should complete before the function terminates.
   *
   * In serverless/edge environments (Vercel Edge, Cloudflare Workers), use
   * `context.waitUntil(result.pending)` to ensure background operations like
   * analytics, multi-region sync, or cleanup complete after the response is sent.
   *
   * Currently resolves immediately, but provides infrastructure for future
   * background operations without changing the API.
   *
   * @example
   * ```ts
   * // Cloudflare Workers
   * const result = await checkRateLimit(options)
   * context.waitUntil(result.pending)
   *
   * // Vercel Edge Functions
   * const result = await checkRateLimit(options)
   * event.waitUntil(result.pending)
   * ```
   */
  pending: Promise<void>
}

// ============================================================================
// Memory Store
// ============================================================================

type MemoryEntry = {
  count: number
  reset: number
}

/**
 * In-memory store for rate limiting.
 *
 * Uses a two-map rotation pattern for O(1) bulk expiration:
 * - Active entries live in `current`; on access, expired entries in `previous`
 *   are discarded and live ones are promoted to `current`.
 * - Every rotation interval, `previous` is replaced by `current` and a fresh
 *   map is created. The old `previous` is garbage-collected by the runtime
 *   without iterating its entries.
 *
 * Features:
 * - Zero dependencies
 * - O(1) bulk cleanup (no per-entry iteration)
 * - Suitable for single-instance deployments
 *
 * @example
 * ```ts
 * import { MemoryStore, checkRateLimit } from '@jfungus/ratelimit'
 *
 * const store = new MemoryStore()
 * store.init(60_000) // 1 minute window
 *
 * const result = await checkRateLimit({
 *   store,
 *   key: 'user:123',
 *   limit: 100,
 *   windowMs: 60_000,
 * })
 * ```
 */
export class MemoryStore implements RateLimitStore {
  private current = new Map<string, MemoryEntry>()
  private previous = new Map<string, MemoryEntry>()
  private windowMs = 60_000
  private rotationTimer?: ReturnType<typeof setInterval>

  /**
   * Look up an entry across both maps.
   * Promotes live entries from `previous` to `current`;
   * returns undefined for expired or missing entries.
   */
  private getEntry(key: string): MemoryEntry | undefined {
    const c = this.current.get(key)
    if (c) {
      return c.reset > Date.now() ? c : undefined
    }
    const p = this.previous.get(key)
    if (p && p.reset > Date.now()) {
      // Promote active entry to current
      this.current.set(key, p)
      this.previous.delete(key)
      return p
    }
    return undefined
  }

  /**
   * Initialize the store with window duration.
   * Sets up the two-map rotation timer.
   */
  init(windowMs: number): void {
    this.windowMs = windowMs

    // Clear existing timer to prevent leaks on re-init
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer)
    }

    // Rotate every 2x windowMs (matches internal 2x TTL for sliding window).
    // Entries created right before rotation survive in `previous` for another
    // full rotation interval, giving them at least 2x windowMs total lifetime.
    const rotationInterval = windowMs * 2

    this.rotationTimer = setInterval(() => {
      // O(1) pointer swap — old `previous` is GC'd by the runtime
      this.previous = this.current
      this.current = new Map()
    }, rotationInterval)

    // Don't keep process alive for cleanup
    if (typeof this.rotationTimer.unref === 'function') {
      this.rotationTimer.unref()
    }
  }

  /**
   * Increment counter and return current state.
   *
   * Note: Internally stores entries with 2x windowMs for sliding window support.
   * Returns the logical 1x reset time to callers.
   */
  increment(key: string, cost = 1): StoreResult {
    const now = Date.now()
    const existing = this.getEntry(key)

    if (!existing) {
      // New window - use 2x windowMs internally for sliding window support
      const internalReset = now + this.windowMs * 2
      const externalReset = now + this.windowMs
      this.current.set(key, { count: cost, reset: internalReset })
      return { count: cost, reset: externalReset }
    }

    // Increment existing (already in `current` via getEntry promotion)
    existing.count += cost
    // Return the logical reset time (internal - windowMs)
    const externalReset = existing.reset - this.windowMs
    return { count: existing.count, reset: externalReset }
  }

  /**
   * Get current state for key.
   *
   * Note: Returns the logical 1x reset time (internal stores 2x for sliding window).
   */
  get(key: string): StoreResult | undefined {
    const entry = this.getEntry(key)
    if (!entry) return undefined
    // Return the logical reset time (internal - windowMs)
    return { count: entry.count, reset: entry.reset - this.windowMs }
  }

  /**
   * Atomic check-and-increment.
   *
   * Checks the sliding/fixed window limit BEFORE incrementing.
   * Rejected requests do not inflate the counter.
   *
   * Inherently atomic in JavaScript's single-threaded event loop.
   */
  checkAndIncrement(options: {
    currentKey: string
    previousKey?: string
    limit: number
    windowMs: number
    cost?: number
  }): StoreCheckResult {
    const { currentKey, previousKey, limit, windowMs, cost = 1 } = options
    const now = Date.now()

    // Get current window count (without incrementing)
    const currentEntry = this.getEntry(currentKey)
    const currentCount = currentEntry?.count ?? 0

    // Get previous window count (for sliding window)
    let previousCount = 0
    if (previousKey) {
      const prevEntry = this.getEntry(previousKey)
      previousCount = prevEntry?.count ?? 0
    }

    // Calculate estimated count (sliding window formula if previousKey, else fixed)
    let estimatedCount: number
    if (previousKey) {
      const currentWindowStart = Math.floor(now / windowMs) * windowMs
      const elapsedMs = now - currentWindowStart
      const weight = (windowMs - elapsedMs) / windowMs
      estimatedCount = Math.floor(previousCount * weight) + currentCount + cost
    } else {
      estimatedCount = currentCount + cost
    }

    const allowed = estimatedCount <= limit
    const currentWindowStart = Math.floor(now / windowMs) * windowMs
    const reset = currentWindowStart + windowMs

    if (allowed) {
      // Only increment when allowed — this is the key optimization
      this.increment(currentKey, cost)
    }

    return {
      allowed,
      // Always return count + cost so callers compute remaining=0 for denied requests
      count: currentCount + cost,
      reset,
      previousCount,
    }
  }

  /**
   * Decrement counter for key.
   */
  decrement(key: string): void {
    const entry = this.getEntry(key)
    if (entry && entry.count > 0) {
      entry.count--
    }
  }

  /**
   * Reset a specific key.
   */
  resetKey(key: string): void {
    this.current.delete(key)
    this.previous.delete(key)
  }

  /**
   * Reset all keys.
   */
  resetAll(): void {
    this.current.clear()
    this.previous.clear()
  }

  /**
   * Graceful shutdown - clean up timers.
   */
  shutdown(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer)
    }
    this.current.clear()
    this.previous.clear()
  }
}

// ============================================================================
// Sliding Window Algorithm
// ============================================================================

// Track if we've warned about sliding window degradation
let slidingWindowWarned = false

/**
 * Check rate limit using the sliding window algorithm.
 *
 * This implements Cloudflare's sliding window approach which provides
 * smoother rate limiting by weighting the previous window's count
 * based on how far we are into the current window.
 *
 * Formula: estimatedCount = floor(previousCount * weight) + currentCount
 * Where weight = (windowMs - elapsedMs) / windowMs
 *
 * @internal
 */
async function checkSlidingWindow(
  store: RateLimitStore,
  key: string,
  limit: number,
  windowMs: number,
  cost = 1,
): Promise<CheckRateLimitResult> {
  const now = Date.now()
  const currentWindowStart = Math.floor(now / windowMs) * windowMs
  const previousWindowStart = currentWindowStart - windowMs

  const previousKey = `${key}:${previousWindowStart}`
  const currentKey = `${key}:${currentWindowStart}`

  // Use atomic checkAndIncrement when available (prevents rejected requests from inflating counters)
  if (store.checkAndIncrement) {
    const result = await store.checkAndIncrement({
      currentKey,
      previousKey,
      limit,
      windowMs,
      cost,
    })

    const previousCount = result.previousCount ?? 0
    const elapsedMs = now - currentWindowStart
    const weight = (windowMs - elapsedMs) / windowMs
    const estimatedCount = Math.floor(previousCount * weight) + result.count

    return {
      allowed: result.allowed,
      info: {
        limit,
        remaining: Math.max(0, limit - estimatedCount),
        reset: result.reset,
      },
      reason: 'limit',
      pending: Promise.resolve(),
    }
  }

  // Fallback: increment-first approach (works but rejected requests inflate the counter)
  const current = await store.increment(currentKey, cost)

  // Get previous window (may not exist)
  let previousCount = 0
  if (store.get) {
    const prev = await store.get(previousKey)
    previousCount = prev?.count ?? 0
  } else if (!slidingWindowWarned) {
    // Warn once that sliding window is degraded to fixed window
    slidingWindowWarned = true
    console.warn(
      '[@jfungus/ratelimit] Store does not implement get() method. ' +
        'Sliding window algorithm will behave like fixed window. ' +
        "Consider using a store with get() support or switch to 'fixed-window' algorithm.",
    )
  }

  // Cloudflare's weighted formula
  const elapsedMs = now - currentWindowStart
  const weight = (windowMs - elapsedMs) / windowMs
  const estimatedCount = Math.floor(previousCount * weight) + current.count

  const remaining = Math.max(0, limit - estimatedCount)
  const allowed = estimatedCount <= limit
  const reset = currentWindowStart + windowMs

  return {
    allowed,
    info: { limit, remaining, reset },
    reason: 'limit',
    pending: Promise.resolve(),
  }
}

// ============================================================================
// Fixed Window Algorithm
// ============================================================================

/**
 * Check rate limit using the fixed window algorithm.
 *
 * Simple counter that resets at fixed time boundaries.
 * Windows are aligned to epoch time (e.g., every minute at :00).
 *
 * Note: This algorithm has a burst vulnerability at window boundaries
 * where a client could make 2x the limit in a short period.
 * Use sliding-window for better protection.
 *
 * @internal
 */
async function checkFixedWindow(
  store: RateLimitStore,
  key: string,
  limit: number,
  windowMs: number,
  cost = 1,
): Promise<CheckRateLimitResult> {
  const now = Date.now()
  const windowStart = Math.floor(now / windowMs) * windowMs
  const windowKey = `${key}:${windowStart}`

  // Use atomic checkAndIncrement when available
  if (store.checkAndIncrement) {
    const result = await store.checkAndIncrement({
      currentKey: windowKey,
      limit,
      windowMs,
      cost,
    })

    return {
      allowed: result.allowed,
      info: {
        limit,
        remaining: Math.max(0, limit - result.count),
        reset: result.reset,
      },
      reason: 'limit',
      pending: Promise.resolve(),
    }
  }

  // Fallback: increment-first approach
  const { count } = await store.increment(windowKey, cost)

  const remaining = Math.max(0, limit - count)
  const allowed = count <= limit
  const reset = windowStart + windowMs

  return {
    allowed,
    info: { limit, remaining, reset },
    reason: 'limit',
    pending: Promise.resolve(),
  }
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Check if a request should be rate limited.
 *
 * This is the core function of the library - it's framework-agnostic and
 * can be used with any HTTP framework or standalone.
 *
 * @param options - Rate limit check options
 * @returns Whether the request is allowed and rate limit info
 *
 * @example
 * ```ts
 * import { checkRateLimit, MemoryStore } from '@jfungus/ratelimit'
 *
 * const store = new MemoryStore()
 * store.init(60_000)
 *
 * // In your request handler:
 * const result = await checkRateLimit({
 *   store,
 *   key: getClientIP(request),
 *   limit: 100,
 *   windowMs: 60_000,
 * })
 *
 * if (!result.allowed) {
 *   return new Response('Too Many Requests', { status: 429 })
 * }
 * ```
 */
export async function checkRateLimit(
  options: CheckRateLimitOptions,
): Promise<CheckRateLimitResult> {
  const {
    store,
    key,
    limit,
    windowMs,
    algorithm = 'sliding-window',
    cost = 1,
    whitelist,
    blacklist,
    blockDuration,
    blockCache,
    timeout,
    fallbackStore,
  } = options

  // Validate
  if (limit <= 0) {
    throw new Error(`[@jfungus/ratelimit] limit must be a positive number, got: ${limit}`)
  }
  if (windowMs <= 0) {
    throw new Error(`[@jfungus/ratelimit] windowMs must be a positive number, got: ${windowMs}`)
  }

  // Whitelist: skip rate limiting entirely
  if (whitelist) {
    const isWhitelisted = typeof whitelist === 'function' ? whitelist(key) : whitelist.includes(key)
    if (isWhitelisted) {
      return {
        allowed: true,
        info: { limit, remaining: limit, reset: Date.now() + windowMs },
        reason: 'limit',
        pending: Promise.resolve(),
      }
    }
  }

  // Blacklist: reject immediately
  if (blacklist) {
    const isBlacklisted = typeof blacklist === 'function' ? blacklist(key) : blacklist.includes(key)
    if (isBlacklisted) {
      return {
        allowed: false,
        info: { limit, remaining: 0, reset: Date.now() + windowMs },
        reason: 'limit',
        pending: Promise.resolve(),
      }
    }
  }

  // Ephemeral block cache: short-circuit if key is already blocked
  if (blockCache) {
    const reset = blockCache.get(key)
    if (reset !== undefined) {
      if (reset > Date.now()) {
        // Still blocked — return rejection without touching the store
        return {
          allowed: false,
          info: { limit, remaining: 0, reset },
          reason: 'cacheBlock',
          pending: Promise.resolve(),
        }
      }
      // Expired — remove from cache
      blockCache.delete(key)
    }
  }

  // Inner function to run the rate limit check against a given store
  const runCheck = async (targetStore: RateLimitStore): Promise<CheckRateLimitResult> => {
    const check =
      algorithm === 'sliding-window'
        ? checkSlidingWindow(targetStore, key, limit, windowMs, cost)
        : checkFixedWindow(targetStore, key, limit, windowMs, cost)

    if (timeout && timeout > 0) {
      return Promise.race([
        check,
        new Promise<CheckRateLimitResult>((resolve) => {
          setTimeout(() => {
            resolve({
              allowed: true,
              info: { limit, remaining: limit, reset: Date.now() + windowMs },
              reason: 'timeout',
              pending: Promise.resolve(),
            })
          }, timeout)
        }),
      ])
    }
    return check
  }

  let result: CheckRateLimitResult

  try {
    result = await runCheck(store)
  } catch (error) {
    // Infrastructure error (not rate limit rejection) — try fallback if available
    if (fallbackStore) {
      const fallbackResult = await runCheck(fallbackStore)
      // Mark as fallback
      result = { ...fallbackResult, reason: 'fallback' }
    } else {
      throw error
    }
  }

  // Cache blocked keys for future short-circuiting
  if (blockCache && !result.allowed) {
    // Ban escalation: use blockDuration if set, otherwise use the window reset
    const banExpiry = blockDuration ? Date.now() + blockDuration : result.info.reset
    blockCache.set(key, banExpiry)
  }

  return result
}

/**
 * Create a rate limiter instance with pre-configured options.
 *
 * This is useful when you want to reuse the same configuration
 * across multiple rate limit checks.
 *
 * @param config - Default configuration
 * @returns A function that checks rate limits with the pre-configured options
 *
 * @example
 * ```ts
 * import { createRateLimiter, MemoryStore } from '@jfungus/ratelimit'
 *
 * const store = new MemoryStore()
 * store.init(60_000)
 *
 * const limiter = createRateLimiter({
 *   store,
 *   limit: 100,
 *   windowMs: 60_000,
 * })
 *
 * // Later, just pass the key:
 * const result = await limiter('user:123')
 * ```
 */
/**
 * A rate limiter instance returned by `createRateLimiter()`.
 */
export type RateLimiterInstance = {
  /**
   * Check if a request should be rate limited.
   * @param key - Unique identifier for the client
   * @param cost - Points consumed by this request (default: 1)
   */
  check: (key: string, cost?: number) => Promise<CheckRateLimitResult>

  /**
   * Consume points from a key without checking/enforcing limits.
   * Use case: WAF detects suspicious behavior, penalize the IP.
   * @param key - Unique identifier for the client
   * @param points - Number of points to consume (default: 1)
   */
  penalty: (key: string, points?: number) => Promise<void>

  /**
   * Give back points to a key without checking limits.
   * Use case: User solves CAPTCHA, restore some quota.
   * @param key - Unique identifier for the client
   * @param points - Number of points to restore (default: 1)
   */
  reward: (key: string, points?: number) => Promise<void>
}

export function createRateLimiter(config: Omit<CheckRateLimitOptions, 'key'>): RateLimiterInstance {
  const instance: RateLimiterInstance = {
    check: (key: string, cost?: number) =>
      checkRateLimit({ ...config, key, ...(cost !== undefined ? { cost } : {}) }),

    async penalty(key: string, points = 1) {
      const now = Date.now()
      const windowStart = Math.floor(now / config.windowMs) * config.windowMs
      const windowKey = `${key}:${windowStart}`
      await config.store.increment(windowKey, points)
    },

    async reward(key: string, points = 1) {
      const now = Date.now()
      const windowStart = Math.floor(now / config.windowMs) * config.windowMs
      const windowKey = `${key}:${windowStart}`
      if (config.store.decrement) {
        for (let i = 0; i < points; i++) {
          await config.store.decrement(windowKey)
        }
      }
    },
  }

  return instance
}

// ============================================================================
// BurstyRateLimiter
// ============================================================================

/**
 * Options for BurstyRateLimiter
 */
export type BurstyRateLimiterOptions = {
  /**
   * Primary limiter for sustained rate limiting.
   * Example: 10 requests per second.
   */
  primary: Omit<CheckRateLimitOptions, 'key'>
  /**
   * Burst limiter for absorbing short bursts.
   * Example: 20 requests per minute burst pool.
   */
  burst: Omit<CheckRateLimitOptions, 'key'>
}

/**
 * A bursty rate limiter instance.
 */
export type BurstyRateLimiterInstance = {
  /**
   * Check if a request should be rate limited.
   *
   * First checks the primary limiter. If rejected, tries the burst limiter.
   * If both reject, the request is denied.
   *
   * @param key - Unique identifier for the client
   * @param cost - Points consumed by this request (default: 1)
   */
  check: (key: string, cost?: number) => Promise<CheckRateLimitResult>
}

/**
 * Create a bursty rate limiter that composes two limiters.
 *
 * When the primary limiter rejects, the burst limiter absorbs overflow.
 * This provides burst tolerance without the complexity of sliding windows.
 *
 * The returned `info` always reflects the primary limiter's state (remaining
 * points come from primary only), keeping the burst pool hidden from callers.
 *
 * @param options - Configuration for primary and burst limiters
 * @returns A bursty rate limiter instance
 *
 * @example
 * ```ts
 * import { createBurstyRateLimiter, MemoryStore } from '@jfungus/ratelimit'
 *
 * const primaryStore = new MemoryStore()
 * primaryStore.init(1000) // 1 second
 *
 * const burstStore = new MemoryStore()
 * burstStore.init(60_000) // 1 minute
 *
 * const limiter = createBurstyRateLimiter({
 *   primary: {
 *     store: primaryStore,
 *     limit: 10,        // 10 requests/second sustained
 *     windowMs: 1000,
 *   },
 *   burst: {
 *     store: burstStore,
 *     limit: 20,        // 20 requests/minute burst pool
 *     windowMs: 60_000,
 *   },
 * })
 *
 * const result = await limiter.check('user:123')
 * ```
 */
export function createBurstyRateLimiter(
  options: BurstyRateLimiterOptions,
): BurstyRateLimiterInstance {
  const { primary, burst } = options

  return {
    async check(key: string, cost?: number): Promise<CheckRateLimitResult> {
      // Try primary limiter first
      const primaryResult = await checkRateLimit({
        ...primary,
        key,
        ...(cost !== undefined ? { cost } : {}),
      })

      if (primaryResult.allowed) {
        return primaryResult
      }

      // Primary rejected — try burst limiter
      const burstResult = await checkRateLimit({
        ...burst,
        key,
        ...(cost !== undefined ? { cost } : {}),
      })

      if (burstResult.allowed) {
        // Burst absorbed the request — return success but with primary's info
        // (burst pool is hidden from callers)
        return {
          allowed: true,
          info: primaryResult.info, // Keep primary's info visible
          reason: 'limit',
          pending: burstResult.pending,
        }
      }

      // Both rejected
      return primaryResult
    },
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Reset the sliding window warning flag.
 * Useful for testing.
 * @internal
 */
export function resetSlidingWindowWarning(): void {
  slidingWindowWarned = false
}

// ============================================================================
// IPv6 Subnet Masking
// ============================================================================

/**
 * Parse an IPv6 address string into 8 x 16-bit groups.
 * Handles full, compressed (::), and IPv4-mapped forms.
 * Returns null for IPv4 or unparseable strings.
 * @internal
 */
function parseIPv6(ip: string): number[] | null {
  // Quick check: must contain a colon to be IPv6
  if (!ip.includes(':')) return null

  // Strip zone ID (%eth0, %25eth0)
  const zoneIdx = ip.indexOf('%')
  const clean = zoneIdx >= 0 ? ip.slice(0, zoneIdx) : ip

  // Handle IPv4-mapped IPv6 (e.g., ::ffff:192.168.1.1)
  const lastColon = clean.lastIndexOf(':')
  const possibleV4 = clean.slice(lastColon + 1)
  let ipv6Part = clean
  let v4Groups: number[] | null = null

  if (possibleV4.includes('.')) {
    const v4Parts = possibleV4.split('.')
    if (v4Parts.length === 4) {
      const octets = v4Parts.map(Number)
      if (octets.every((o) => o >= 0 && o <= 255 && !Number.isNaN(o))) {
        v4Groups = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]]
        ipv6Part = clean.slice(0, lastColon)
        // Handle trailing :: case (e.g., "::ffff:" -> "::")
        if (ipv6Part.endsWith(':') && !ipv6Part.endsWith('::')) {
          ipv6Part = ipv6Part.slice(0, -1)
        }
      }
    }
  }

  const targetGroups = v4Groups ? 6 : 8

  // Expand :: notation
  if (ipv6Part.includes('::')) {
    const parts = ipv6Part.split('::')
    if (parts.length > 2) return null // Multiple :: is invalid

    const left = parts[0] ? parts[0].split(':').map((h) => Number.parseInt(h, 16)) : []
    const right = parts[1] ? parts[1].split(':').map((h) => Number.parseInt(h, 16)) : []
    const fillCount = targetGroups - left.length - right.length

    if (fillCount < 0) return null
    const groups = [...left, ...Array(fillCount).fill(0), ...right]
    return v4Groups ? [...groups, ...v4Groups] : groups
  }

  const groups = ipv6Part.split(':').map((h) => Number.parseInt(h, 16))
  if (groups.length !== targetGroups) return null
  return v4Groups ? [...groups, ...v4Groups] : groups
}

/**
 * Format 8 x 16-bit groups as a canonical IPv6 string (lower-case, no compression).
 * Uses the uncompressed form for consistent key generation.
 * @internal
 */
function formatIPv6(groups: number[]): string {
  return groups.map((g) => g.toString(16).padStart(4, '0')).join(':')
}

/**
 * Apply subnet masking to an IPv6 address.
 *
 * Zeroes all bits beyond the prefix length, returning a canonical
 * uncompressed representation suitable for use as a rate limit key.
 *
 * @param ip - Raw IP address string (IPv4 or IPv6)
 * @param prefixLength - Subnet prefix length (default: 56). Use `false` to disable masking.
 * @returns The masked IP (IPv6) or the original string (IPv4 or when disabled)
 *
 * @example
 * ```ts
 * maskIPv6('2001:db8:1234:5678:abcd:ef01:2345:6789')
 * // => '2001:0db8:0123:0400:0000:0000:0000:0000'  (masked to /56)
 *
 * maskIPv6('192.168.1.1')
 * // => '192.168.1.1'  (IPv4 returned as-is)
 * ```
 */
export function maskIPv6(ip: string, prefixLength: number | false = 56): string {
  if (prefixLength === false) return ip

  const groups = parseIPv6(ip)
  if (!groups || groups.length !== 8) return ip // Not IPv6, return as-is

  // Apply the bitmask
  const masked = new Array(8)
  for (let i = 0; i < 8; i++) {
    const bitStart = i * 16
    if (bitStart >= prefixLength) {
      // Entirely beyond prefix: zero out
      masked[i] = 0
    } else if (bitStart + 16 <= prefixLength) {
      // Entirely within prefix: keep
      masked[i] = groups[i]
    } else {
      // Partial: mask the boundary group
      const bitsToKeep = prefixLength - bitStart
      const mask = 0xffff << (16 - bitsToKeep)
      masked[i] = groups[i] & mask
    }
  }

  return `${formatIPv6(masked)}/${prefixLength}`
}
