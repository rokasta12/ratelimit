import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MemoryStore,
  type RateLimitStore,
  checkRateLimit,
  createBurstyRateLimiter,
  createRateLimiter,
  maskIPv6,
  resetSlidingWindowWarning,
} from './index'

describe('@jfungus/ratelimit core', () => {
  describe('MemoryStore', () => {
    let store: MemoryStore

    beforeEach(() => {
      store = new MemoryStore()
      store.init(60_000)
    })

    afterEach(() => {
      store.shutdown()
    })

    it('increments counter', () => {
      const result1 = store.increment('key1')
      expect(result1.count).toBe(1)
      expect(result1.reset).toBeGreaterThan(Date.now())

      const result2 = store.increment('key1')
      expect(result2.count).toBe(2)
    })

    it('returns undefined for non-existent key', () => {
      expect(store.get('nonexistent')).toBeUndefined()
    })

    it('gets existing key', () => {
      store.increment('key1')
      const result = store.get('key1')
      expect(result).toBeDefined()
      expect(result?.count).toBe(1)
    })

    it('decrements counter', () => {
      store.increment('key1')
      store.increment('key1')
      store.decrement('key1')
      const result = store.get('key1')
      expect(result?.count).toBe(1)
    })

    it('does not decrement below zero', () => {
      store.increment('key1')
      store.decrement('key1')
      store.decrement('key1')
      const result = store.get('key1')
      expect(result?.count).toBe(0)
    })

    it('resets specific key', () => {
      store.increment('key1')
      store.increment('key2')
      store.resetKey('key1')
      expect(store.get('key1')).toBeUndefined()
      expect(store.get('key2')).toBeDefined()
    })

    it('resets all keys', () => {
      store.increment('key1')
      store.increment('key2')
      store.resetAll()
      expect(store.get('key1')).toBeUndefined()
      expect(store.get('key2')).toBeUndefined()
    })

    it('expires entries after window', () => {
      vi.useFakeTimers()
      const shortStore = new MemoryStore()
      shortStore.init(1000) // 1 second window

      shortStore.increment('key1')
      expect(shortStore.get('key1')).toBeDefined()

      // Entries are stored with 2x windowMs internally for sliding window support
      // So they expire after 2x the window duration
      vi.advanceTimersByTime(2001)
      expect(shortStore.get('key1')).toBeUndefined()

      shortStore.shutdown()
      vi.useRealTimers()
    })

    it('creates new window after expiry', () => {
      vi.useFakeTimers()
      const shortStore = new MemoryStore()
      shortStore.init(1000)

      const result1 = shortStore.increment('key1')
      expect(result1.count).toBe(1)

      // Entries expire after 2x windowMs (internal storage for sliding window)
      vi.advanceTimersByTime(2001)
      const result2 = shortStore.increment('key1')
      expect(result2.count).toBe(1) // New window

      shortStore.shutdown()
      vi.useRealTimers()
    })
  })

  describe('checkRateLimit', () => {
    let store: MemoryStore

    beforeEach(() => {
      store = new MemoryStore()
      store.init(60_000)
      resetSlidingWindowWarning()
    })

    afterEach(() => {
      store.shutdown()
    })

    it('allows requests under limit', async () => {
      const result = await checkRateLimit({
        store,
        key: 'test',
        limit: 10,
        windowMs: 60_000,
      })

      expect(result.allowed).toBe(true)
      expect(result.info.limit).toBe(10)
      expect(result.info.remaining).toBe(9)
    })

    it('blocks requests over limit', async () => {
      for (let i = 0; i < 10; i++) {
        await checkRateLimit({
          store,
          key: 'test',
          limit: 10,
          windowMs: 60_000,
        })
      }

      const result = await checkRateLimit({
        store,
        key: 'test',
        limit: 10,
        windowMs: 60_000,
      })

      expect(result.allowed).toBe(false)
      expect(result.info.remaining).toBe(0)
    })

    it('tracks different keys separately', async () => {
      await checkRateLimit({ store, key: 'user1', limit: 2, windowMs: 60_000 })
      await checkRateLimit({ store, key: 'user1', limit: 2, windowMs: 60_000 })
      await checkRateLimit({ store, key: 'user1', limit: 2, windowMs: 60_000 })

      const result1 = await checkRateLimit({
        store,
        key: 'user1',
        limit: 2,
        windowMs: 60_000,
      })
      const result2 = await checkRateLimit({
        store,
        key: 'user2',
        limit: 2,
        windowMs: 60_000,
      })

      expect(result1.allowed).toBe(false)
      expect(result2.allowed).toBe(true)
    })

    it('throws on invalid limit', async () => {
      await expect(
        checkRateLimit({ store, key: 'test', limit: 0, windowMs: 60_000 }),
      ).rejects.toThrow('limit must be a positive number')

      await expect(
        checkRateLimit({ store, key: 'test', limit: -1, windowMs: 60_000 }),
      ).rejects.toThrow('limit must be a positive number')
    })

    it('throws on invalid windowMs', async () => {
      await expect(checkRateLimit({ store, key: 'test', limit: 10, windowMs: 0 })).rejects.toThrow(
        'windowMs must be a positive number',
      )

      await expect(checkRateLimit({ store, key: 'test', limit: 10, windowMs: -1 })).rejects.toThrow(
        'windowMs must be a positive number',
      )
    })

    describe('fixed-window algorithm', () => {
      it('uses fixed window when specified', async () => {
        const result = await checkRateLimit({
          store,
          key: 'test',
          limit: 10,
          windowMs: 60_000,
          algorithm: 'fixed-window',
        })

        expect(result.allowed).toBe(true)
        expect(result.info.remaining).toBe(9)
      })

      it('resets at window boundary', async () => {
        vi.useFakeTimers()
        const shortStore = new MemoryStore()
        shortStore.init(1000)

        await checkRateLimit({
          store: shortStore,
          key: 'test',
          limit: 2,
          windowMs: 1000,
          algorithm: 'fixed-window',
        })

        await checkRateLimit({
          store: shortStore,
          key: 'test',
          limit: 2,
          windowMs: 1000,
          algorithm: 'fixed-window',
        })

        let result = await checkRateLimit({
          store: shortStore,
          key: 'test',
          limit: 2,
          windowMs: 1000,
          algorithm: 'fixed-window',
        })
        expect(result.allowed).toBe(false)

        // Advance past window
        vi.advanceTimersByTime(1001)

        result = await checkRateLimit({
          store: shortStore,
          key: 'test',
          limit: 2,
          windowMs: 1000,
          algorithm: 'fixed-window',
        })
        expect(result.allowed).toBe(true)
        expect(result.info.remaining).toBe(1)

        shortStore.shutdown()
        vi.useRealTimers()
      })
    })

    describe('sliding-window algorithm', () => {
      it('uses sliding window by default', async () => {
        const result = await checkRateLimit({
          store,
          key: 'test',
          limit: 10,
          windowMs: 60_000,
        })

        expect(result.allowed).toBe(true)
      })

      it('considers previous window in calculation', async () => {
        vi.useFakeTimers()
        const windowMs = 10_000 // 10 seconds
        const shortStore = new MemoryStore()
        shortStore.init(windowMs)

        // Make 5 requests at the end of a window
        const windowStart = Math.floor(Date.now() / windowMs) * windowMs
        vi.setSystemTime(windowStart + windowMs - 100) // 100ms before window ends

        for (let i = 0; i < 5; i++) {
          await checkRateLimit({
            store: shortStore,
            key: 'test',
            limit: 10,
            windowMs,
          })
        }

        // Move to middle of next window (50% through)
        vi.setSystemTime(windowStart + windowMs + 5000)

        // With sliding window, the previous 5 requests should still count
        // Weight = (10000 - 5000) / 10000 = 0.5
        // Estimated = floor(5 * 0.5) + 1 = 2 + 1 = 3
        // Remaining = 10 - 3 = 7
        const result = await checkRateLimit({
          store: shortStore,
          key: 'test',
          limit: 10,
          windowMs,
        })

        expect(result.allowed).toBe(true)
        // With fixed window, remaining would be 9 (only current request)
        // With sliding window, remaining should be less due to previous window weight
        expect(result.info.remaining).toBeLessThan(9)

        shortStore.shutdown()
        vi.useRealTimers()
      })

      it('warns when store does not support get()', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const storeWithoutGet: RateLimitStore = {
          increment: () => ({ count: 1, reset: Date.now() + 60_000 }),
          resetKey: () => {},
        }

        await checkRateLimit({
          store: storeWithoutGet,
          key: 'test',
          limit: 10,
          windowMs: 60_000,
          algorithm: 'sliding-window',
        })

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Store does not implement get() method'),
        )

        consoleSpy.mockRestore()
      })
    })
  })

  describe('createRateLimiter', () => {
    let store: MemoryStore

    beforeEach(() => {
      store = new MemoryStore()
      store.init(60_000)
    })

    afterEach(() => {
      store.shutdown()
    })

    it('creates a reusable limiter', async () => {
      const limiter = createRateLimiter({
        store,
        limit: 5,
        windowMs: 60_000,
      })

      const result1 = await limiter.check('user1')
      expect(result1.allowed).toBe(true)
      expect(result1.info.remaining).toBe(4)

      const result2 = await limiter.check('user1')
      expect(result2.allowed).toBe(true)
      expect(result2.info.remaining).toBe(3)
    })

    it('uses configured algorithm', async () => {
      const limiter = createRateLimiter({
        store,
        limit: 5,
        windowMs: 60_000,
        algorithm: 'fixed-window',
      })

      const result = await limiter.check('user1')
      expect(result.allowed).toBe(true)
    })

    it('penalty consumes points without blocking', async () => {
      const limiter = createRateLimiter({
        store,
        limit: 10,
        windowMs: 60_000,
      })

      // Penalize with 8 points
      await limiter.penalty('user1', 8)

      // Next check should show reduced remaining
      const result = await limiter.check('user1')
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBeLessThanOrEqual(2)
    })

    it('reward gives back points', async () => {
      const limiter = createRateLimiter({
        store,
        limit: 3,
        windowMs: 60_000,
      })

      // Use up 2 of 3 points
      await limiter.check('user1')
      await limiter.check('user1')

      // Reward 1 point
      await limiter.reward('user1', 1)

      // Should have 2 remaining now
      const result = await limiter.check('user1')
      expect(result.allowed).toBe(true)
    })
  })

  describe('whitelist/blacklist', () => {
    let store: MemoryStore

    beforeEach(() => {
      store = new MemoryStore()
      store.init(60_000)
    })

    afterEach(() => {
      store.shutdown()
    })

    it('whitelisted keys are always allowed (array)', async () => {
      for (let i = 0; i < 20; i++) {
        const result = await checkRateLimit({
          store, key: 'vip', limit: 1, windowMs: 60_000,
          whitelist: ['vip'],
        })
        expect(result.allowed).toBe(true)
        expect(result.info.remaining).toBe(1)
      }
    })

    it('whitelisted keys are always allowed (function)', async () => {
      const result = await checkRateLimit({
        store, key: 'admin-123', limit: 1, windowMs: 60_000,
        whitelist: (k) => k.startsWith('admin-'),
      })
      expect(result.allowed).toBe(true)
    })

    it('blacklisted keys are always rejected (array)', async () => {
      const result = await checkRateLimit({
        store, key: 'bad-actor', limit: 100, windowMs: 60_000,
        blacklist: ['bad-actor'],
      })
      expect(result.allowed).toBe(false)
      expect(result.info.remaining).toBe(0)
    })

    it('blacklisted keys are always rejected (function)', async () => {
      const result = await checkRateLimit({
        store, key: 'banned-ip', limit: 100, windowMs: 60_000,
        blacklist: (k) => k.startsWith('banned-'),
      })
      expect(result.allowed).toBe(false)
    })

    it('non-listed keys are rate limited normally', async () => {
      const r1 = await checkRateLimit({
        store, key: 'normal', limit: 2, windowMs: 60_000,
        whitelist: ['vip'], blacklist: ['banned'],
      })
      expect(r1.allowed).toBe(true)
      expect(r1.info.remaining).toBe(1)
    })
  })

  describe('cost/weight system', () => {
    let store: MemoryStore

    beforeEach(() => {
      store = new MemoryStore()
      store.init(60_000)
    })

    afterEach(() => {
      store.shutdown()
    })

    it('consumes multiple points per request', async () => {
      const result = await checkRateLimit({
        store, key: 'test', limit: 10, windowMs: 60_000, cost: 5,
      })
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(5)

      // Next request with cost 5 uses up remaining
      const r2 = await checkRateLimit({
        store, key: 'test', limit: 10, windowMs: 60_000, cost: 5,
      })
      expect(r2.allowed).toBe(true)
      expect(r2.info.remaining).toBe(0)

      // Next request exceeds limit
      const r3 = await checkRateLimit({
        store, key: 'test', limit: 10, windowMs: 60_000, cost: 1,
      })
      expect(r3.allowed).toBe(false)
    })

    it('defaults cost to 1 (backward compatible)', async () => {
      const r1 = await checkRateLimit({
        store, key: 'test', limit: 3, windowMs: 60_000,
      })
      expect(r1.info.remaining).toBe(2)

      const r2 = await checkRateLimit({
        store, key: 'test', limit: 3, windowMs: 60_000,
      })
      expect(r2.info.remaining).toBe(1)
    })

    it('works with fixed window algorithm', async () => {
      const r1 = await checkRateLimit({
        store, key: 'test', limit: 10, windowMs: 60_000,
        algorithm: 'fixed-window', cost: 7,
      })
      expect(r1.allowed).toBe(true)
      expect(r1.info.remaining).toBe(3)

      const r2 = await checkRateLimit({
        store, key: 'test', limit: 10, windowMs: 60_000,
        algorithm: 'fixed-window', cost: 4,
      })
      expect(r2.allowed).toBe(false)
    })

    it('MemoryStore increment accepts cost parameter', () => {
      const r1 = store.increment('key1', 5)
      expect(r1.count).toBe(5)

      const r2 = store.increment('key1', 3)
      expect(r2.count).toBe(8)
    })
  })

  describe('timeout', () => {
    it('allows request through when store times out', async () => {
      const slowStore: RateLimitStore = {
        increment: () => new Promise((resolve) => {
          setTimeout(() => resolve({ count: 999, reset: Date.now() + 60_000 }), 5000)
        }),
        resetKey: () => {},
      }

      const result = await checkRateLimit({
        store: slowStore,
        key: 'test',
        limit: 1,
        windowMs: 60_000,
        timeout: 50,
      })

      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(1)
      expect(result.reason).toBe('timeout')
    })

    it('returns normal result when store responds in time', async () => {
      const store = new MemoryStore()
      store.init(60_000)

      const result = await checkRateLimit({
        store,
        key: 'test',
        limit: 10,
        windowMs: 60_000,
        timeout: 5000,
      })

      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(9)
      store.shutdown()
    })

    it('works without timeout (default behavior)', async () => {
      const store = new MemoryStore()
      store.init(60_000)

      const result = await checkRateLimit({
        store,
        key: 'test',
        limit: 10,
        windowMs: 60_000,
      })

      expect(result.allowed).toBe(true)
      store.shutdown()
    })
  })

  describe('blockCache', () => {
    let store: MemoryStore

    beforeEach(() => {
      store = new MemoryStore()
      store.init(60_000)
    })

    afterEach(() => {
      store.shutdown()
    })

    it('returns cacheBlock reason for cached denials', async () => {
      const blockCache = new Map<string, number>()
      blockCache.set('test', Date.now() + 60_000)

      const result = await checkRateLimit({
        store, key: 'test', limit: 10, windowMs: 60_000, blockCache,
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('cacheBlock')
    })

    it('caches blocked keys and short-circuits store lookups', async () => {
      const blockCache = new Map<string, number>()
      const opts = { store, key: 'test', limit: 1, windowMs: 60_000, blockCache }

      // First request: allowed
      const r1 = await checkRateLimit(opts)
      expect(r1.allowed).toBe(true)
      expect(blockCache.size).toBe(0)

      // Second request: blocked, added to cache
      const r2 = await checkRateLimit(opts)
      expect(r2.allowed).toBe(false)
      expect(blockCache.size).toBe(1)

      // Third request: short-circuited from cache (no store hit)
      const r3 = await checkRateLimit(opts)
      expect(r3.allowed).toBe(false)
      expect(r3.info.remaining).toBe(0)
    })

    it('expires cache entries after reset time', async () => {
      vi.useFakeTimers()
      const blockCache = new Map<string, number>()

      // Manually add a block that expires in 100ms
      blockCache.set('test', Date.now() + 100)

      // Should be blocked
      const r1 = await checkRateLimit({
        store, key: 'test', limit: 10, windowMs: 60_000, blockCache,
      })
      expect(r1.allowed).toBe(false)

      // Advance past expiry
      vi.advanceTimersByTime(101)

      // Should hit the store now (cache expired)
      const r2 = await checkRateLimit({
        store, key: 'test', limit: 10, windowMs: 60_000, blockCache,
      })
      expect(r2.allowed).toBe(true)
      expect(blockCache.size).toBe(0)

      vi.useRealTimers()
    })

    it('ban escalation extends block duration', async () => {
      vi.useFakeTimers()
      const blockCache = new Map<string, number>()
      const opts = {
        store, key: 'test', limit: 1, windowMs: 60_000,
        blockCache, blockDuration: 3600_000, // 1 hour ban
      }

      // First request allowed
      await checkRateLimit(opts)

      // Second request blocked — should be banned for 1 hour
      const r2 = await checkRateLimit(opts)
      expect(r2.allowed).toBe(false)

      const banExpiry = blockCache.get('test')!
      expect(banExpiry).toBeGreaterThan(Date.now() + 3599_000)

      // Advance past window reset but within ban
      vi.advanceTimersByTime(120_000) // 2 minutes
      const r3 = await checkRateLimit(opts)
      expect(r3.allowed).toBe(false)
      expect(r3.reason).toBe('cacheBlock')

      vi.useRealTimers()
    })

    it('works without blockCache (default behavior)', async () => {
      const r1 = await checkRateLimit({
        store, key: 'test', limit: 1, windowMs: 60_000,
      })
      expect(r1.allowed).toBe(true)

      const r2 = await checkRateLimit({
        store, key: 'test', limit: 1, windowMs: 60_000,
      })
      expect(r2.allowed).toBe(false)
    })
  })

  describe('pending promise', () => {
    it('returns pending promise for serverless waitUntil', async () => {
      const store = new MemoryStore()
      store.init(60_000)

      const result = await checkRateLimit({
        store, key: 'test', limit: 10, windowMs: 60_000,
      })

      expect(result.pending).toBeInstanceOf(Promise)
      await expect(result.pending).resolves.toBeUndefined()
      store.shutdown()
    })

    it('returns pending promise on rate limit rejection', async () => {
      const store = new MemoryStore()
      store.init(60_000)

      // Exhaust limit
      await checkRateLimit({ store, key: 'test', limit: 1, windowMs: 60_000 })
      const result = await checkRateLimit({ store, key: 'test', limit: 1, windowMs: 60_000 })

      expect(result.allowed).toBe(false)
      expect(result.pending).toBeInstanceOf(Promise)
      await expect(result.pending).resolves.toBeUndefined()
      store.shutdown()
    })
  })

  describe('fallbackStore', () => {
    it('uses fallback when primary store throws', async () => {
      const failingStore: RateLimitStore = {
        increment: () => { throw new Error('Redis connection refused') },
        resetKey: () => {},
      }
      const fallbackStore = new MemoryStore()
      fallbackStore.init(60_000)

      const result = await checkRateLimit({
        store: failingStore,
        fallbackStore,
        key: 'test',
        limit: 10,
        windowMs: 60_000,
      })

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('fallback')
      expect(result.info.remaining).toBe(9)
      fallbackStore.shutdown()
    })

    it('fallback store enforces limits', async () => {
      const failingStore: RateLimitStore = {
        increment: () => { throw new Error('Redis connection refused') },
        resetKey: () => {},
      }
      const fallbackStore = new MemoryStore()
      fallbackStore.init(60_000)

      // Exhaust the limit
      await checkRateLimit({ store: failingStore, fallbackStore, key: 'test', limit: 1, windowMs: 60_000 })
      const result = await checkRateLimit({ store: failingStore, fallbackStore, key: 'test', limit: 1, windowMs: 60_000 })

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('fallback')
      fallbackStore.shutdown()
    })

    it('throws error when primary fails and no fallback provided', async () => {
      const failingStore: RateLimitStore = {
        increment: () => { throw new Error('Redis connection refused') },
        resetKey: () => {},
      }

      await expect(checkRateLimit({
        store: failingStore,
        key: 'test',
        limit: 10,
        windowMs: 60_000,
      })).rejects.toThrow('Redis connection refused')
    })

    it('uses primary store when it works (fallback not touched)', async () => {
      const primaryStore = new MemoryStore()
      primaryStore.init(60_000)
      const fallbackStore = new MemoryStore()
      fallbackStore.init(60_000)

      // Make a request — should use primary
      const result = await checkRateLimit({
        store: primaryStore,
        fallbackStore,
        key: 'test',
        limit: 10,
        windowMs: 60_000,
      })

      expect(result.allowed).toBe(true)
      expect(result.reason).toBe('limit') // Not 'fallback'
      expect(result.info.remaining).toBe(9)

      // Fallback should still have full limit (untouched)
      expect(fallbackStore.get('test:' + Math.floor(Date.now() / 60_000) * 60_000)).toBeUndefined()

      primaryStore.shutdown()
      fallbackStore.shutdown()
    })
  })

  describe('createBurstyRateLimiter', () => {
    it('allows requests under primary limit', async () => {
      const primaryStore = new MemoryStore()
      primaryStore.init(1000)
      const burstStore = new MemoryStore()
      burstStore.init(60_000)

      const limiter = createBurstyRateLimiter({
        primary: { store: primaryStore, limit: 5, windowMs: 1000 },
        burst: { store: burstStore, limit: 10, windowMs: 60_000 },
      })

      const result = await limiter.check('user1')
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(4)

      primaryStore.shutdown()
      burstStore.shutdown()
    })

    it('uses burst pool when primary is exhausted', async () => {
      const primaryStore = new MemoryStore()
      primaryStore.init(1000)
      const burstStore = new MemoryStore()
      burstStore.init(60_000)

      const limiter = createBurstyRateLimiter({
        primary: { store: primaryStore, limit: 2, windowMs: 1000 },
        burst: { store: burstStore, limit: 5, windowMs: 60_000 },
      })

      // Exhaust primary (2 requests)
      await limiter.check('user1')
      await limiter.check('user1')

      // Third request should use burst pool
      const result = await limiter.check('user1')
      expect(result.allowed).toBe(true)
      // Info should reflect primary's state (remaining=0)
      expect(result.info.remaining).toBe(0)

      primaryStore.shutdown()
      burstStore.shutdown()
    })

    it('rejects when both primary and burst are exhausted', async () => {
      const primaryStore = new MemoryStore()
      primaryStore.init(1000)
      const burstStore = new MemoryStore()
      burstStore.init(60_000)

      const limiter = createBurstyRateLimiter({
        primary: { store: primaryStore, limit: 1, windowMs: 1000 },
        burst: { store: burstStore, limit: 1, windowMs: 60_000 },
      })

      // Exhaust primary
      await limiter.check('user1')
      // Exhaust burst
      await limiter.check('user1')
      // Now both should be exhausted
      const result = await limiter.check('user1')
      expect(result.allowed).toBe(false)

      primaryStore.shutdown()
      burstStore.shutdown()
    })

    it('supports cost parameter', async () => {
      const primaryStore = new MemoryStore()
      primaryStore.init(1000)
      const burstStore = new MemoryStore()
      burstStore.init(60_000)

      const limiter = createBurstyRateLimiter({
        primary: { store: primaryStore, limit: 10, windowMs: 1000 },
        burst: { store: burstStore, limit: 20, windowMs: 60_000 },
      })

      // Consume 8 points from primary
      const r1 = await limiter.check('user1', 8)
      expect(r1.allowed).toBe(true)
      expect(r1.info.remaining).toBe(2)

      // 5 more points would exceed primary, should use burst
      const r2 = await limiter.check('user1', 5)
      expect(r2.allowed).toBe(true)
      expect(r2.info.remaining).toBe(0) // Primary shows 0

      primaryStore.shutdown()
      burstStore.shutdown()
    })
  })

  describe('checkAndIncrement (check-before-write)', () => {
    let store: MemoryStore

    beforeEach(() => {
      store = new MemoryStore()
      store.init(60_000)
    })

    afterEach(() => {
      store.shutdown()
    })

    it('rejected requests do not inflate the counter (sliding window)', async () => {
      // Exhaust the limit
      for (let i = 0; i < 5; i++) {
        await checkRateLimit({ store, key: 'test', limit: 5, windowMs: 60_000 })
      }

      // Make 10 rejected requests
      for (let i = 0; i < 10; i++) {
        const r = await checkRateLimit({ store, key: 'test', limit: 5, windowMs: 60_000 })
        expect(r.allowed).toBe(false)
      }

      // Verify the counter is still 5 (not 15)
      const windowStart = Math.floor(Date.now() / 60_000) * 60_000
      const windowKey = `test:${windowStart}`
      const storeResult = store.get(windowKey)
      expect(storeResult?.count).toBe(5)
    })

    it('rejected requests do not inflate the counter (fixed window)', async () => {
      // Exhaust the limit
      for (let i = 0; i < 3; i++) {
        await checkRateLimit({ store, key: 'test', limit: 3, windowMs: 60_000, algorithm: 'fixed-window' })
      }

      // Make 5 rejected requests
      for (let i = 0; i < 5; i++) {
        const r = await checkRateLimit({ store, key: 'test', limit: 3, windowMs: 60_000, algorithm: 'fixed-window' })
        expect(r.allowed).toBe(false)
      }

      // Verify the counter is still 3 (not 8)
      const windowStart = Math.floor(Date.now() / 60_000) * 60_000
      const windowKey = `test:${windowStart}`
      const storeResult = store.get(windowKey)
      expect(storeResult?.count).toBe(3)
    })

    it('allowed requests still increment the counter', async () => {
      const r1 = await checkRateLimit({ store, key: 'test', limit: 5, windowMs: 60_000 })
      expect(r1.allowed).toBe(true)
      expect(r1.info.remaining).toBe(4)

      const r2 = await checkRateLimit({ store, key: 'test', limit: 5, windowMs: 60_000 })
      expect(r2.allowed).toBe(true)
      expect(r2.info.remaining).toBe(3)

      const windowStart = Math.floor(Date.now() / 60_000) * 60_000
      const windowKey = `test:${windowStart}`
      expect(store.get(windowKey)?.count).toBe(2)
    })

    it('falls back to increment-first for stores without checkAndIncrement', async () => {
      const basicStore: RateLimitStore = {
        increment: (key: string, cost = 1) => {
          return store.increment(key, cost)
        },
        get: (key: string) => store.get(key),
        resetKey: (key: string) => store.resetKey(key),
        // No checkAndIncrement — should use fallback path
      }

      const r1 = await checkRateLimit({ store: basicStore, key: 'test', limit: 2, windowMs: 60_000 })
      expect(r1.allowed).toBe(true)
    })
  })

  describe('maskIPv6', () => {
    it('returns IPv4 addresses unchanged', () => {
      expect(maskIPv6('192.168.1.1')).toBe('192.168.1.1')
      expect(maskIPv6('10.0.0.1')).toBe('10.0.0.1')
    })

    it('masks full IPv6 to /56', () => {
      const result = maskIPv6('2001:0db8:1234:5678:abcd:ef01:2345:6789')
      expect(result).toBe('2001:0db8:1234:5600:0000:0000:0000:0000/56')
    })

    it('masks compressed IPv6', () => {
      const result = maskIPv6('2001:db8::1')
      expect(result).toBe('2001:0db8:0000:0000:0000:0000:0000:0000/56')
    })

    it('masks with custom prefix length', () => {
      const result = maskIPv6('2001:db8:1234:5678:abcd:ef01:2345:6789', 48)
      expect(result).toBe('2001:0db8:1234:0000:0000:0000:0000:0000/48')
    })

    it('returns full address with /128', () => {
      const result = maskIPv6('2001:db8::1', 128)
      expect(result).toBe('2001:0db8:0000:0000:0000:0000:0000:0001/128')
    })

    it('returns original string when masking is disabled', () => {
      expect(maskIPv6('2001:db8::1', false)).toBe('2001:db8::1')
    })

    it('handles IPv4-mapped IPv6', () => {
      const result = maskIPv6('::ffff:192.168.1.1')
      expect(result).toBe('0000:0000:0000:0000:0000:0000:0000:0000/56')
    })

    it('handles loopback', () => {
      const result = maskIPv6('::1')
      expect(result).toBe('0000:0000:0000:0000:0000:0000:0000:0000/56')
    })

    it('groups same /56 subnet together', () => {
      const ip1 = maskIPv6('2001:db8:1234:5600::1')
      const ip2 = maskIPv6('2001:db8:1234:56ff::9999')
      expect(ip1).toBe(ip2)
    })

    it('separates different /56 subnets', () => {
      const ip1 = maskIPv6('2001:db8:1234:5600::1')
      const ip2 = maskIPv6('2001:db8:1234:5700::1')
      expect(ip1).not.toBe(ip2)
    })

    it('handles zone ID in IPv6', () => {
      const result = maskIPv6('fe80::1%eth0')
      expect(result).toBe('fe80:0000:0000:0000:0000:0000:0000:0000/56')
    })
  })
})
