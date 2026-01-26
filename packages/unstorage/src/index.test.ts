import { createStorage } from 'unstorage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createNuxtStore, createUnstorageStore } from './index'

describe('@jf/ratelimit-unstorage', () => {
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
      const store = createUnstorageStore({ storage })
      store.init?.(100) // 100ms window

      const result1 = await store.increment('key1')
      expect(result1.count).toBe(1)

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      const result2 = await store.increment('key1')
      expect(result2.count).toBe(1) // New window
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
