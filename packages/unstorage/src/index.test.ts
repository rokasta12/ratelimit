import { checkRateLimit } from '@jfungus/ratelimit'
import { createStorage } from 'unstorage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNuxtStore, createUnstorageStore } from './index'

describe('@jfungus/ratelimit-unstorage', () => {
  describe('createUnstorageStore', () => {
    let storage: ReturnType<typeof createStorage>

    beforeEach(() => {
      storage = createStorage()
    })

    afterEach(async () => {
      await storage.clear()
    })

    it('creates a store with default prefix', () => {
      const store = createUnstorageStore({ storage })
      expect(store).toBeDefined()
      expect(typeof store.increment).toBe('function')
      expect(typeof store.get).toBe('function')
      expect(typeof store.resetKey).toBe('function')
    })

    it('initializes with window duration', () => {
      const store = createUnstorageStore({ storage })
      store.init?.(30_000)
      // Should not throw
      expect(true).toBe(true)
    })

    it('increments counter', async () => {
      const store = createUnstorageStore({ storage })
      store.init?.(60_000)

      const result1 = await store.increment('key1')
      expect(result1.count).toBe(1)
      expect(result1.reset).toBeGreaterThan(Date.now())

      const result2 = await store.increment('key1')
      expect(result2.count).toBe(2)
    })

    it('uses custom prefix', async () => {
      const store = createUnstorageStore({ storage, prefix: 'custom:' })
      store.init?.(60_000)

      await store.increment('key1')

      const keys = await storage.getKeys()
      expect(keys.some((k) => k.startsWith('custom:'))).toBe(true)
    })

    it('gets existing entry', async () => {
      const store = createUnstorageStore({ storage })
      store.init?.(60_000)

      await store.increment('key1')
      const result = await store.get?.('key1')

      expect(result).toBeDefined()
      expect(result?.count).toBe(1)
    })

    it('returns undefined for non-existent key', async () => {
      const store = createUnstorageStore({ storage })
      store.init?.(60_000)

      const result = await store.get?.('nonexistent')
      expect(result).toBeUndefined()
    })

    it('decrements counter', async () => {
      const store = createUnstorageStore({ storage })
      store.init?.(60_000)

      await store.increment('key1')
      await store.increment('key1')
      await store.decrement?.('key1')

      const result = await store.get?.('key1')
      expect(result?.count).toBe(1)
    })

    it('resets specific key', async () => {
      const store = createUnstorageStore({ storage })
      store.init?.(60_000)

      await store.increment('key1')
      await store.increment('key2')
      await store.resetKey('key1')

      expect(await store.get?.('key1')).toBeUndefined()
      expect(await store.get?.('key2')).toBeDefined()
    })

    it('resets all keys', async () => {
      const store = createUnstorageStore({ storage })
      store.init?.(60_000)

      await store.increment('key1')
      await store.increment('key2')
      await store.resetAll?.()

      expect(await store.get?.('key1')).toBeUndefined()
      expect(await store.get?.('key2')).toBeUndefined()
    })

    it('creates new window after expiry', async () => {
      vi.useFakeTimers()
      const store = createUnstorageStore({ storage })
      store.init?.(1000) // 1 second window

      const result1 = await store.increment('key1')
      expect(result1.count).toBe(1)

      // Internal storage is 2x windowMs, so entry expires after 2000ms
      vi.advanceTimersByTime(2001)

      const result2 = await store.increment('key1')
      expect(result2.count).toBe(1) // New window
      vi.useRealTimers()
    })

    it('keeps previous window data alive for sliding window support', async () => {
      vi.useFakeTimers()
      const store = createUnstorageStore({ storage })
      const windowMs = 10_000
      store.init?.(windowMs)

      await store.increment('key1')
      await store.increment('key1')

      // At 1.5x windowMs: logically expired, but internal 2x reset keeps it alive
      vi.advanceTimersByTime(windowMs * 1.5)

      const result = await store.get?.('key1')
      expect(result).toBeDefined()
      expect(result?.count).toBe(2)

      // At 2x windowMs + 1: internal reset has passed, entry is truly expired
      vi.advanceTimersByTime(windowMs * 0.5 + 1)

      const expired = await store.get?.('key1')
      expect(expired).toBeUndefined()
      vi.useRealTimers()
    })

    it('returns logical 1x reset time externally', async () => {
      vi.useFakeTimers()
      const store = createUnstorageStore({ storage })
      const windowMs = 60_000
      store.init?.(windowMs)

      const now = Date.now()
      const result = await store.increment('key1')

      // External reset should be exactly now + windowMs (fake timers = deterministic)
      expect(result.reset).toBe(now + windowMs)

      // get() should return the same external reset
      const getResult = await store.get?.('key1')
      expect(getResult?.reset).toBe(result.reset)
      vi.useRealTimers()
    })

    it('returns consistent reset across multiple increments', async () => {
      const store = createUnstorageStore({ storage })
      store.init?.(60_000)

      const result1 = await store.increment('key1')
      const result2 = await store.increment('key1')
      const result3 = await store.increment('key1')

      expect(result2.reset).toBe(result1.reset)
      expect(result3.reset).toBe(result1.reset)
    })

    it('tracks different keys separately', async () => {
      const store = createUnstorageStore({ storage })
      store.init?.(60_000)

      await store.increment('user1')
      await store.increment('user1')
      await store.increment('user2')

      expect((await store.get?.('user1'))?.count).toBe(2)
      expect((await store.get?.('user2'))?.count).toBe(1)
    })
  })

  describe('sliding window integration', () => {
    let storage: ReturnType<typeof createStorage>

    beforeEach(() => {
      vi.useFakeTimers()
      storage = createStorage()
    })

    afterEach(async () => {
      await storage.clear()
      vi.useRealTimers()
    })

    it('previous window data is available for sliding window weighting', async () => {
      const store = createUnstorageStore({ storage })
      const windowMs = 10_000
      store.init?.(windowMs)

      const windowStart = Math.floor(Date.now() / windowMs) * windowMs

      // Make 50 requests in current window
      vi.setSystemTime(windowStart + 100)
      for (let i = 0; i < 50; i++) {
        await checkRateLimit({ store, key: 'test', limit: 100, windowMs })
      }

      // Move to 50% into next window
      vi.setSystemTime(windowStart + windowMs + 5000)

      // Sliding window should weight previous window:
      // weight = (10000 - 5000) / 10000 = 0.5
      // estimated = floor(50 * 0.5) + 1 = 26
      // remaining = 100 - 26 = 74
      const result = await checkRateLimit({ store, key: 'test', limit: 100, windowMs })
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(74)
    })

    it('previous window data expires after 2x windowMs', async () => {
      const store = createUnstorageStore({ storage })
      const windowMs = 10_000
      store.init?.(windowMs)

      const windowStart = Math.floor(Date.now() / windowMs) * windowMs

      // Make 50 requests in window 0
      vi.setSystemTime(windowStart + 100)
      for (let i = 0; i < 50; i++) {
        await checkRateLimit({ store, key: 'test', limit: 100, windowMs })
      }

      // Move to window 2 (2x windowMs later) — previous window data should be gone
      vi.setSystemTime(windowStart + windowMs * 2 + 5000)

      // No previous window data, so remaining = 100 - 1 = 99
      const result = await checkRateLimit({ store, key: 'test', limit: 100, windowMs })
      expect(result.allowed).toBe(true)
      expect(result.info.remaining).toBe(99)
    })
  })

  describe('createNuxtStore', () => {
    it('creates a store with default prefix', () => {
      const storage = createStorage()
      const store = createNuxtStore(storage)

      expect(store).toBeDefined()
      expect(typeof store.increment).toBe('function')
    })

    it('accepts custom prefix', async () => {
      const storage = createStorage()
      const store = createNuxtStore(storage, 'nuxt:ratelimit:')
      store.init?.(60_000)

      await store.increment('key1')

      const keys = await storage.getKeys()
      expect(keys.some((k) => k.startsWith('nuxt:ratelimit:'))).toBe(true)
    })
  })
})
