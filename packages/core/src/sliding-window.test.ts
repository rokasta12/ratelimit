import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MemoryStore,
  type RateLimitStore,
  type StoreResult,
  checkRateLimit,
  resetSlidingWindowWarning,
} from './index'

/**
 * Comprehensive test suite for the sliding window algorithm.
 *
 * Tests cover:
 * - Weight calculation at various points in the window
 * - Burst protection (sliding vs fixed window behavior)
 * - Multi-key isolation
 * - Concurrent request handling
 * - Edge cases (limit=1, limit=10000, short/long windows)
 * - Store compatibility (sync/async)
 * - Real-world scenarios (API limits, DDoS, login protection)
 */
describe('Sliding Window Algorithm', () => {
  let store: MemoryStore
  const windowMs = 10_000 // 10 seconds for easier math

  beforeEach(() => {
    vi.useFakeTimers()
    store = new MemoryStore()
    store.init(windowMs)
    resetSlidingWindowWarning()
  })

  afterEach(() => {
    store.shutdown()
    vi.useRealTimers()
  })

  describe('Weight Calculation', () => {
    it('calculates weight at 0.01% of window (start)', async () => {
      const limit = 100
      // Set time at beginning of a window
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs
      vi.setSystemTime(windowStart + 1) // 0.01% into window

      // Make 50 requests in previous window
      vi.setSystemTime(windowStart - windowMs + 100) // Previous window
      for (let i = 0; i < 50; i++) {
        await checkRateLimit({ store, key: 'test', limit, windowMs })
      }

      // Move to 0.01% into new window (weight ≈ 0.9999)
      vi.setSystemTime(windowStart + 1)
      const result = await checkRateLimit({ store, key: 'test', limit, windowMs })

      // Weight = (10000 - 1) / 10000 ≈ 0.9999
      // Estimated = floor(50 * 0.9999) + 1 = 49 + 1 = 50
      // Remaining = 100 - 50 = 50
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(50)
    })

    it('calculates weight at 10% of window', async () => {
      const limit = 100
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs

      // Make 50 requests in previous window
      vi.setSystemTime(windowStart - windowMs + 100)
      for (let i = 0; i < 50; i++) {
        await checkRateLimit({ store, key: 'test', limit, windowMs })
      }

      // Move to 10% into new window (weight = 0.9)
      vi.setSystemTime(windowStart + 1000)
      const result = await checkRateLimit({ store, key: 'test', limit, windowMs })

      // Weight = (10000 - 1000) / 10000 = 0.9
      // Estimated = floor(50 * 0.9) + 1 = 45 + 1 = 46
      // Remaining = 100 - 46 = 54
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(54)
    })

    it('calculates weight at 25% of window', async () => {
      const limit = 100
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs

      // Make 50 requests in previous window
      vi.setSystemTime(windowStart - windowMs + 100)
      for (let i = 0; i < 50; i++) {
        await checkRateLimit({ store, key: 'test', limit, windowMs })
      }

      // Move to 25% into new window (weight = 0.75)
      vi.setSystemTime(windowStart + 2500)
      const result = await checkRateLimit({ store, key: 'test', limit, windowMs })

      // Weight = (10000 - 2500) / 10000 = 0.75
      // Estimated = floor(50 * 0.75) + 1 = 37 + 1 = 38
      // Remaining = 100 - 38 = 62
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(62)
    })

    it('calculates weight at 50% of window', async () => {
      const limit = 100
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs

      // Make 50 requests in previous window
      vi.setSystemTime(windowStart - windowMs + 100)
      for (let i = 0; i < 50; i++) {
        await checkRateLimit({ store, key: 'test', limit, windowMs })
      }

      // Move to 50% into new window (weight = 0.5)
      vi.setSystemTime(windowStart + 5000)
      const result = await checkRateLimit({ store, key: 'test', limit, windowMs })

      // Weight = (10000 - 5000) / 10000 = 0.5
      // Estimated = floor(50 * 0.5) + 1 = 25 + 1 = 26
      // Remaining = 100 - 26 = 74
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(74)
    })

    it('calculates weight at 75% of window', async () => {
      const limit = 100
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs

      // Make 50 requests in previous window
      vi.setSystemTime(windowStart - windowMs + 100)
      for (let i = 0; i < 50; i++) {
        await checkRateLimit({ store, key: 'test', limit, windowMs })
      }

      // Move to 75% into new window (weight = 0.25)
      vi.setSystemTime(windowStart + 7500)
      const result = await checkRateLimit({ store, key: 'test', limit, windowMs })

      // Weight = (10000 - 7500) / 10000 = 0.25
      // Estimated = floor(50 * 0.25) + 1 = 12 + 1 = 13
      // Remaining = 100 - 13 = 87
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(87)
    })

    it('calculates weight at 90% of window', async () => {
      const limit = 100
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs

      // Make 50 requests in previous window
      vi.setSystemTime(windowStart - windowMs + 100)
      for (let i = 0; i < 50; i++) {
        await checkRateLimit({ store, key: 'test', limit, windowMs })
      }

      // Move to 90% into new window (weight = 0.1)
      vi.setSystemTime(windowStart + 9000)
      const result = await checkRateLimit({ store, key: 'test', limit, windowMs })

      // Weight = (10000 - 9000) / 10000 = 0.1
      // Estimated = floor(50 * 0.1) + 1 = 5 + 1 = 6
      // Remaining = 100 - 6 = 94
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(94)
    })

    it('calculates weight at 99% of window (end)', async () => {
      const limit = 100
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs

      // Make 50 requests in previous window
      vi.setSystemTime(windowStart - windowMs + 100)
      for (let i = 0; i < 50; i++) {
        await checkRateLimit({ store, key: 'test', limit, windowMs })
      }

      // Move to 99% into new window (weight ≈ 0.01)
      vi.setSystemTime(windowStart + 9900)
      const result = await checkRateLimit({ store, key: 'test', limit, windowMs })

      // Weight = (10000 - 9900) / 10000 = 0.01
      // Estimated = floor(50 * 0.01) + 1 = 0 + 1 = 1
      // Remaining = 100 - 1 = 99
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(99)
    })
  })

  describe('Burst Protection', () => {
    it('prevents burst at window boundary (sliding window)', async () => {
      const limit = 10

      const windowStart = Math.floor(Date.now() / windowMs) * windowMs

      // Make 10 requests at end of previous window
      vi.setSystemTime(windowStart - 100) // 100ms before window ends
      for (let i = 0; i < 10; i++) {
        await checkRateLimit({ store, key: 'burst', limit, windowMs })
      }

      // Move to 1% into new window (weight ≈ 0.99)
      vi.setSystemTime(windowStart + 100)

      // With sliding window, these should be blocked
      const result = await checkRateLimit({ store, key: 'burst', limit, windowMs })

      // Weight = (10000 - 100) / 10000 = 0.99
      // Estimated = floor(10 * 0.99) + 1 = 9 + 1 = 10
      // Should allow exactly one more (10 <= 10)
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(0)

      // Next request should be blocked
      const blocked = await checkRateLimit({ store, key: 'burst', limit, windowMs })
      expect(blocked.allowed).toBe(false)
    })

    it('fixed window allows burst at boundary', async () => {
      const limit = 10

      const windowStart = Math.floor(Date.now() / windowMs) * windowMs

      // Make 10 requests at end of previous window
      vi.setSystemTime(windowStart - 100)
      for (let i = 0; i < 10; i++) {
        await checkRateLimit({
          store,
          key: 'burst-fixed',
          limit,
          windowMs,
          algorithm: 'fixed-window',
        })
      }

      // Move to start of new window
      vi.setSystemTime(windowStart + 100)

      // With fixed window, all 10 requests are allowed again
      for (let i = 0; i < 10; i++) {
        const result = await checkRateLimit({
          store,
          key: 'burst-fixed',
          limit,
          windowMs,
          algorithm: 'fixed-window',
        })
        expect(result.allowed).toBe(true)
      }
    })

    it('sliding window provides smoother rate limiting', async () => {
      const limit = 100
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs

      // Exhaust limit at end of window
      vi.setSystemTime(windowStart - 500)
      for (let i = 0; i < 100; i++) {
        await checkRateLimit({ store, key: 'smooth', limit, windowMs })
      }

      // Move to 50% into new window
      vi.setSystemTime(windowStart + 5000)

      // Sliding window should allow ~50 more (100 - floor(100 * 0.5))
      let allowedCount = 0
      for (let i = 0; i < 60; i++) {
        const result = await checkRateLimit({ store, key: 'smooth', limit, windowMs })
        if (result.allowed) allowedCount++
      }

      // Should allow approximately 50 requests
      expect(allowedCount).toBeGreaterThanOrEqual(45)
      expect(allowedCount).toBeLessThanOrEqual(55)
    })
  })

  describe('Multi-Key Isolation', () => {
    it('tracks different keys independently', async () => {
      const limit = 5

      // Exhaust limit for user1
      for (let i = 0; i < 5; i++) {
        await checkRateLimit({ store, key: 'user:1', limit, windowMs })
      }

      // user1 should be blocked
      const user1Result = await checkRateLimit({ store, key: 'user:1', limit, windowMs })
      expect(user1Result.allowed).toBe(false)

      // user2 should have full limit available
      const user2Result = await checkRateLimit({ store, key: 'user:2', limit, windowMs })
      expect(user2Result.allowed).toBe(true)
      expect(user2Result.info.remaining).toBe(4)
    })

    it('handles many keys without cross-contamination', async () => {
      const limit = 10
      const keys = Array.from({ length: 100 }, (_, i) => `key:${i}`)

      // Make varying requests for each key
      for (let i = 0; i < keys.length; i++) {
        const requestCount = i % 15 // 0-14 requests per key
        for (let j = 0; j < requestCount; j++) {
          await checkRateLimit({ store, key: keys[i]!, limit, windowMs })
        }
      }

      // Verify each key has correct remaining
      for (let i = 0; i < keys.length; i++) {
        const requestCount = i % 15
        const result = await checkRateLimit({ store, key: keys[i]!, limit, windowMs })

        if (requestCount >= limit) {
          // Should be blocked
          expect(result.allowed).toBe(false)
        } else {
          // Should have correct remaining
          expect(result.info.remaining).toBe(Math.max(0, limit - requestCount - 1))
        }
      }
    })

    it('isolates keys across different windows', async () => {
      const limit = 10
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs

      // user1: requests in previous window
      vi.setSystemTime(windowStart - windowMs + 100)
      for (let i = 0; i < 8; i++) {
        await checkRateLimit({ store, key: 'user:1', limit, windowMs })
      }

      // user2: requests in current window
      vi.setSystemTime(windowStart + 100)
      for (let i = 0; i < 3; i++) {
        await checkRateLimit({ store, key: 'user:2', limit, windowMs })
      }

      // At 50% into current window
      vi.setSystemTime(windowStart + 5000)

      // user1: weight = 0.5, estimated = floor(8 * 0.5) + 1 = 5
      const user1 = await checkRateLimit({ store, key: 'user:1', limit, windowMs })
      expect(user1.info.remaining).toBe(5)

      // user2: only current window counts, estimated = 3 + 1 = 4
      const user2 = await checkRateLimit({ store, key: 'user:2', limit, windowMs })
      expect(user2.info.remaining).toBe(6)
    })
  })

  describe('Concurrent Request Handling', () => {
    it('handles rapid sequential requests', async () => {
      const limit = 100
      const results: boolean[] = []

      for (let i = 0; i < 150; i++) {
        const result = await checkRateLimit({ store, key: 'rapid', limit, windowMs })
        results.push(result.allowed)
      }

      // First 100 should be allowed, next 50 blocked
      expect(results.slice(0, 100).every((r) => r)).toBe(true)
      expect(results.slice(100).every((r) => !r)).toBe(true)
    })

    it('handles concurrent requests (Promise.all)', async () => {
      const limit = 50

      const promises = Array.from({ length: 100 }, () =>
        checkRateLimit({ store, key: 'concurrent', limit, windowMs }),
      )

      const results = await Promise.all(promises)
      const allowedCount = results.filter((r) => r.allowed).length

      // Due to race conditions, exactly 50 should be allowed
      expect(allowedCount).toBe(50)
    })
  })

  describe('Edge Cases', () => {
    it('handles limit=1', async () => {
      const limit = 1

      const first = await checkRateLimit({ store, key: 'single', limit, windowMs })
      expect(first.allowed).toBe(true)
      expect(first.info.remaining).toBe(0)

      const second = await checkRateLimit({ store, key: 'single', limit, windowMs })
      expect(second.allowed).toBe(false)
    })

    it('handles very high limit (10000)', async () => {
      const limit = 10000

      // Make 9999 requests
      for (let i = 0; i < 9999; i++) {
        await checkRateLimit({ store, key: 'high', limit, windowMs })
      }

      // 10000th should be allowed
      const result = await checkRateLimit({ store, key: 'high', limit, windowMs })
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(0)

      // 10001st should be blocked
      const blocked = await checkRateLimit({ store, key: 'high', limit, windowMs })
      expect(blocked.allowed).toBe(false)
    })

    it('handles very short window (100ms)', async () => {
      const shortWindowMs = 100
      const shortStore = new MemoryStore()
      shortStore.init(shortWindowMs)

      const limit = 5

      const windowStart = Math.floor(Date.now() / shortWindowMs) * shortWindowMs
      vi.setSystemTime(windowStart + 10)

      // Exhaust limit (5 requests)
      for (let i = 0; i < 5; i++) {
        await checkRateLimit({ store: shortStore, key: 'short', limit, windowMs: shortWindowMs })
      }

      // 6th request is blocked but still counted
      const blocked = await checkRateLimit({
        store: shortStore,
        key: 'short',
        limit,
        windowMs: shortWindowMs,
      })
      expect(blocked.allowed).toBe(false)

      // Move to 50% into next window (weight = 0.5)
      vi.setSystemTime(windowStart + shortWindowMs + 50)

      // Previous window has 6 requests (5 allowed + 1 blocked)
      // Weight = 0.5, estimated = floor(6 * 0.5) + 1 = 3 + 1 = 4
      // Remaining = 5 - 4 = 1
      const allowed = await checkRateLimit({
        store: shortStore,
        key: 'short',
        limit,
        windowMs: shortWindowMs,
      })
      expect(allowed.allowed).toBe(true)
      expect(allowed.info.remaining).toBe(1)

      shortStore.shutdown()
    })

    it('handles very long window (1 hour)', async () => {
      const longWindowMs = 60 * 60 * 1000 // 1 hour
      const longStore = new MemoryStore()
      longStore.init(longWindowMs)

      const limit = 1000
      const windowStart = Math.floor(Date.now() / longWindowMs) * longWindowMs

      // Make requests in previous hour
      vi.setSystemTime(windowStart - longWindowMs + 1000)
      for (let i = 0; i < 500; i++) {
        await checkRateLimit({ store: longStore, key: 'long', limit, windowMs: longWindowMs })
      }

      // Move to 50% into current hour
      vi.setSystemTime(windowStart + longWindowMs / 2)

      // Weight = 0.5, estimated = floor(500 * 0.5) + 1 = 251
      const result = await checkRateLimit({
        store: longStore,
        key: 'long',
        limit,
        windowMs: longWindowMs,
      })
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(749) // 1000 - 251

      longStore.shutdown()
    })

    it('handles zero previous count', async () => {
      const limit = 10

      // No previous requests
      const result = await checkRateLimit({ store, key: 'fresh', limit, windowMs })

      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(9) // 10 - 1
    })

    it('handles exact limit count', async () => {
      const limit = 5

      for (let i = 0; i < 5; i++) {
        await checkRateLimit({ store, key: 'exact', limit, windowMs })
      }

      // 5th request consumed the limit
      const result = await checkRateLimit({ store, key: 'exact', limit, windowMs })
      expect(result.allowed).toBe(false)
      expect(result.info.remaining).toBe(0)
    })
  })

  describe('Store Compatibility', () => {
    it('works with synchronous store', async () => {
      const syncStore: RateLimitStore = {
        entries: new Map<string, { count: number; reset: number }>(),
        windowMs: 10000,

        init(windowMs: number) {
          this.windowMs = windowMs
        },

        increment(key: string): StoreResult {
          const now = Date.now()
          const existing = this.entries.get(key)

          if (!existing || existing.reset <= now) {
            const internalReset = now + this.windowMs * 2
            const externalReset = now + this.windowMs
            this.entries.set(key, { count: 1, reset: internalReset })
            return { count: 1, reset: externalReset }
          }

          existing.count++
          return { count: existing.count, reset: existing.reset - this.windowMs }
        },

        get(key: string): StoreResult | undefined {
          const entry = this.entries.get(key)
          if (!entry || entry.reset <= Date.now()) {
            return undefined
          }
          return { count: entry.count, reset: entry.reset - this.windowMs }
        },

        resetKey(key: string) {
          this.entries.delete(key)
        },
      } as RateLimitStore & {
        entries: Map<string, { count: number; reset: number }>
        windowMs: number
      }

      syncStore.init!(windowMs)

      const result = await checkRateLimit({ store: syncStore, key: 'sync', limit: 5, windowMs })
      expect(result.allowed).toBe(true)
    })

    it('works with async store', async () => {
      const asyncStore: RateLimitStore = {
        entries: new Map<string, { count: number; reset: number }>(),
        windowMs: 10000,

        async init(windowMs: number) {
          this.windowMs = windowMs
          await Promise.resolve() // Simulate async
        },

        async increment(key: string): Promise<StoreResult> {
          await Promise.resolve() // Simulate async
          const now = Date.now()
          const existing = this.entries.get(key)

          if (!existing || existing.reset <= now) {
            const internalReset = now + this.windowMs * 2
            const externalReset = now + this.windowMs
            this.entries.set(key, { count: 1, reset: internalReset })
            return { count: 1, reset: externalReset }
          }

          existing.count++
          return { count: existing.count, reset: existing.reset - this.windowMs }
        },

        async get(key: string): Promise<StoreResult | undefined> {
          await Promise.resolve() // Simulate async
          const entry = this.entries.get(key)
          if (!entry || entry.reset <= Date.now()) {
            return undefined
          }
          return { count: entry.count, reset: entry.reset - this.windowMs }
        },

        async resetKey(key: string) {
          await Promise.resolve()
          this.entries.delete(key)
        },
      } as RateLimitStore & {
        entries: Map<string, { count: number; reset: number }>
        windowMs: number
      }

      await asyncStore.init!(windowMs)

      const result = await checkRateLimit({ store: asyncStore, key: 'async', limit: 5, windowMs })
      expect(result.allowed).toBe(true)
    })

    it('degrades gracefully without get() method', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const noGetStore: RateLimitStore = {
        entries: new Map<string, { count: number; reset: number }>(),
        windowMs: 10000,

        init(windowMs: number) {
          this.windowMs = windowMs
        },

        increment(key: string): StoreResult {
          const now = Date.now()
          const existing = this.entries.get(key)

          if (!existing || existing.reset <= now) {
            const reset = now + this.windowMs
            this.entries.set(key, { count: 1, reset })
            return { count: 1, reset }
          }

          existing.count++
          return { count: existing.count, reset: existing.reset }
        },

        resetKey(key: string) {
          this.entries.delete(key)
        },
      } as RateLimitStore & {
        entries: Map<string, { count: number; reset: number }>
        windowMs: number
      }

      noGetStore.init!(windowMs)

      const result = await checkRateLimit({ store: noGetStore, key: 'noget', limit: 5, windowMs })
      expect(result.allowed).toBe(true)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('does not implement get()'))

      consoleSpy.mockRestore()
    })
  })

  describe('Real-World Scenarios', () => {
    it('simulates API rate limiting (100 req/min)', async () => {
      const apiWindowMs = 60_000 // 1 minute
      const apiStore = new MemoryStore()
      apiStore.init(apiWindowMs)
      const limit = 100

      const windowStart = Math.floor(Date.now() / apiWindowMs) * apiWindowMs
      vi.setSystemTime(windowStart + 1000)

      // Normal usage: 50 requests
      for (let i = 0; i < 50; i++) {
        const result = await checkRateLimit({
          store: apiStore,
          key: 'api:user123',
          limit,
          windowMs: apiWindowMs,
        })
        expect(result.allowed).toBe(true)
      }

      // Verify remaining
      const status = await checkRateLimit({
        store: apiStore,
        key: 'api:user123',
        limit,
        windowMs: apiWindowMs,
      })
      expect(status.info.remaining).toBe(49)

      apiStore.shutdown()
    })

    it('simulates DDoS protection (1000 req/sec)', async () => {
      const ddosWindowMs = 1000 // 1 second
      const ddosStore = new MemoryStore()
      ddosStore.init(ddosWindowMs)
      const limit = 1000

      const windowStart = Math.floor(Date.now() / ddosWindowMs) * ddosWindowMs
      vi.setSystemTime(windowStart + 100)

      // Simulate attack: 1500 requests
      let blocked = 0
      for (let i = 0; i < 1500; i++) {
        const result = await checkRateLimit({
          store: ddosStore,
          key: 'ip:attacker',
          limit,
          windowMs: ddosWindowMs,
        })
        if (!result.allowed) blocked++
      }

      expect(blocked).toBe(500) // 500 blocked

      ddosStore.shutdown()
    })

    it('simulates login attempt protection (5 attempts/15min)', async () => {
      const loginWindowMs = 15 * 60 * 1000 // 15 minutes
      const loginStore = new MemoryStore()
      loginStore.init(loginWindowMs)
      const limit = 5

      const windowStart = Math.floor(Date.now() / loginWindowMs) * loginWindowMs
      vi.setSystemTime(windowStart + 1000)

      // 5 failed login attempts
      for (let i = 0; i < 5; i++) {
        await checkRateLimit({
          store: loginStore,
          key: 'login:user@example.com',
          limit,
          windowMs: loginWindowMs,
        })
      }

      // 6th attempt should be blocked (but still counted)
      const blocked = await checkRateLimit({
        store: loginStore,
        key: 'login:user@example.com',
        limit,
        windowMs: loginWindowMs,
      })
      expect(blocked.allowed).toBe(false)

      // Move to 50% into NEXT window for sliding window to take effect
      vi.setSystemTime(windowStart + loginWindowMs + loginWindowMs / 2)

      // Previous window has 6 requests (5 allowed + 1 blocked)
      // Weight = 0.5, estimated = floor(6 * 0.5) + 1 = 3 + 1 = 4
      // Remaining = 5 - 4 = 1
      const partial = await checkRateLimit({
        store: loginStore,
        key: 'login:user@example.com',
        limit,
        windowMs: loginWindowMs,
      })
      expect(partial.allowed).toBe(true)
      expect(partial.info.remaining).toBe(1)

      loginStore.shutdown()
    })

    it('simulates tiered rate limiting', async () => {
      const tierWindowMs = 60_000

      // Free tier: 10 req/min
      const freeStore = new MemoryStore()
      freeStore.init(tierWindowMs)
      const freeLimit = 10

      // Pro tier: 100 req/min
      const proStore = new MemoryStore()
      proStore.init(tierWindowMs)
      const proLimit = 100

      const windowStart = Math.floor(Date.now() / tierWindowMs) * tierWindowMs
      vi.setSystemTime(windowStart + 1000)

      // Free user hits limit after 10 requests
      for (let i = 0; i < 10; i++) {
        await checkRateLimit({
          store: freeStore,
          key: 'user:free',
          limit: freeLimit,
          windowMs: tierWindowMs,
        })
      }
      const freeBlocked = await checkRateLimit({
        store: freeStore,
        key: 'user:free',
        limit: freeLimit,
        windowMs: tierWindowMs,
      })
      expect(freeBlocked.allowed).toBe(false)

      // Pro user can make 100 requests
      for (let i = 0; i < 99; i++) {
        await checkRateLimit({
          store: proStore,
          key: 'user:pro',
          limit: proLimit,
          windowMs: tierWindowMs,
        })
      }
      const proAllowed = await checkRateLimit({
        store: proStore,
        key: 'user:pro',
        limit: proLimit,
        windowMs: tierWindowMs,
      })
      expect(proAllowed.allowed).toBe(true)

      freeStore.shutdown()
      proStore.shutdown()
    })

    it('simulates gradual recovery after burst', async () => {
      const limit = 100
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs

      // Exhaust limit
      vi.setSystemTime(windowStart + 100)
      for (let i = 0; i < 100; i++) {
        await checkRateLimit({ store, key: 'recovery', limit, windowMs })
      }

      // Check recovery at different points
      const checkpoints = [
        { position: 0.25, expectedRemaining: 24 }, // 25% through: ~25 available
        { position: 0.5, expectedRemaining: 49 }, // 50% through: ~50 available
        { position: 0.75, expectedRemaining: 74 }, // 75% through: ~75 available
        { position: 0.9, expectedRemaining: 89 }, // 90% through: ~90 available
      ]

      for (const checkpoint of checkpoints) {
        // Reset store for clean test
        store.resetAll()

        // Re-exhaust at start of window
        vi.setSystemTime(windowStart + 100)
        for (let i = 0; i < 100; i++) {
          await checkRateLimit({ store, key: 'recovery', limit, windowMs })
        }

        // Move to checkpoint position in next window
        vi.setSystemTime(windowStart + windowMs + windowMs * checkpoint.position)

        const result = await checkRateLimit({ store, key: 'recovery', limit, windowMs })

        // Allow some variance due to integer math
        expect(result.info.remaining).toBeGreaterThanOrEqual(checkpoint.expectedRemaining - 2)
        expect(result.info.remaining).toBeLessThanOrEqual(checkpoint.expectedRemaining + 2)
      }
    })
  })

  describe('Algorithm Comparison', () => {
    it('sliding window is more conservative than fixed window at boundary', async () => {
      const limit = 10
      const windowStart = Math.floor(Date.now() / windowMs) * windowMs

      // Make 10 requests at very end of window
      vi.setSystemTime(windowStart - 10)
      for (let i = 0; i < 10; i++) {
        await checkRateLimit({ store, key: 'compare-sliding', limit, windowMs })
        await checkRateLimit({
          store,
          key: 'compare-fixed',
          limit,
          windowMs,
          algorithm: 'fixed-window',
        })
      }

      // Move to just after window boundary
      vi.setSystemTime(windowStart + 10)

      // Fixed window: full limit available
      const fixed = await checkRateLimit({
        store,
        key: 'compare-fixed',
        limit,
        windowMs,
        algorithm: 'fixed-window',
      })
      expect(fixed.info.remaining).toBe(9) // 10 - 1

      // Sliding window: previous requests still weighted
      const sliding = await checkRateLimit({ store, key: 'compare-sliding', limit, windowMs })
      expect(sliding.info.remaining).toBeLessThan(fixed.info.remaining)
    })
  })
})
