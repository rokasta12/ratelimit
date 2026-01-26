import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MemoryStore,
  type RateLimitStore,
  checkRateLimit,
  createRateLimiter,
  resetSlidingWindowWarning,
} from './index'

describe('@jf/ratelimit core', () => {
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

      vi.advanceTimersByTime(1001)
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

      vi.advanceTimersByTime(1001)
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

      const result1 = await limiter('user1')
      expect(result1.allowed).toBe(true)
      expect(result1.info.remaining).toBe(4)

      const result2 = await limiter('user1')
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

      const result = await limiter('user1')
      expect(result.allowed).toBe(true)
    })
  })
})
