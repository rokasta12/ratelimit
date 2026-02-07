/**
 * @jfungus/ratelimit-unstorage - unstorage adapter for @jfungus/ratelimit
 *
 * Provides a storage adapter that works with any unstorage driver,
 * including Redis, Cloudflare KV, Vercel KV, Upstash, and more.
 *
 * @module
 */

import type { RateLimitStore, StoreResult } from '@jfungus/ratelimit'
import type { Storage } from 'unstorage'

// Re-export core types
export type { RateLimitStore, StoreResult } from '@jfungus/ratelimit'

// ============================================================================
// Types
// ============================================================================

/**
 * Entry stored in unstorage
 */
type StoredEntry = {
  /** Request count in window */
  count: number
  /** Window reset time (Unix timestamp ms) */
  reset: number
}

/**
 * Options for creating an unstorage store
 */
export type UnstorageStoreOptions = {
  /**
   * unstorage instance to use
   */
  storage: Storage

  /**
   * Key prefix for rate limit entries.
   * Useful when sharing storage with other data.
   * @default 'ratelimit:'
   */
  prefix?: string
}

// ============================================================================
// Unstorage Store
// ============================================================================

/**
 * Create a rate limit store backed by unstorage.
 *
 * Works with any unstorage driver, including:
 * - `memory` - In-memory storage
 * - `redis` - Redis/Valkey
 * - `cloudflare-kv-binding` - Cloudflare KV
 * - `vercel-kv` - Vercel KV
 * - `upstash` - Upstash Redis
 * - `fs` - File system
 * - And many more...
 *
 * **⚠️ Multi-instance warning:** The `increment()` operation uses a non-atomic
 * read-then-write pattern (`getItem` → `setItem`). In multi-instance deployments
 * (multiple servers sharing the same storage backend), concurrent requests can
 * cause lost updates — two requests may read the same count and both write
 * `count + 1` instead of `count + 2`. This allows more requests through than
 * the configured limit. For single-instance deployments or low-concurrency
 * scenarios, this is not a concern. For high-concurrency distributed setups,
 * consider using the in-memory `MemoryStore` per-instance or a storage driver
 * that supports atomic operations natively.
 *
 * @param options - Store configuration
 * @returns Rate limit store instance
 *
 * @example
 * ```ts
 * import { createStorage } from 'unstorage'
 * import redisDriver from 'unstorage/drivers/redis'
 * import { createUnstorageStore } from '@jfungus/ratelimit-unstorage'
 * import { rateLimiter } from '@jfungus/ratelimit-hono'
 *
 * const storage = createStorage({
 *   driver: redisDriver({ url: 'redis://localhost:6379' }),
 * })
 *
 * const store = createUnstorageStore({ storage })
 *
 * app.use(rateLimiter({
 *   store,
 *   limit: 100,
 *   windowMs: 60_000,
 * }))
 * ```
 *
 * @example Using with Cloudflare KV
 * ```ts
 * import { createStorage } from 'unstorage'
 * import cloudflareKVBindingDriver from 'unstorage/drivers/cloudflare-kv-binding'
 *
 * const storage = createStorage({
 *   driver: cloudflareKVBindingDriver({ binding: env.RATE_LIMIT_KV }),
 * })
 *
 * const store = createUnstorageStore({ storage })
 * ```
 */
export function createUnstorageStore(options: UnstorageStoreOptions): RateLimitStore {
  const { storage, prefix = 'ratelimit:' } = options
  let windowMs = 60_000

  /**
   * Get the full key with prefix
   */
  function getKey(key: string): string {
    return `${prefix}${key}`
  }

  /**
   * Calculate TTL in seconds for new entries (for drivers that support it).
   * Uses 2x windowMs + 10% buffer to ensure key doesn't expire before window ends.
   */
  function getNewEntryTtlSeconds(): number {
    return Math.ceil((windowMs * 2 * 1.1) / 1000)
  }

  /**
   * Calculate remaining TTL in seconds for an existing entry.
   * Uses the entry's actual reset time instead of recalculating from scratch,
   * avoiding unnecessarily extending the key's lifetime in storage.
   */
  function getRemainingTtlSeconds(reset: number): number {
    const remainingMs = reset - Date.now()
    // 10% buffer so the key outlives the logical window
    return Math.max(1, Math.ceil((remainingMs * 1.1) / 1000))
  }

  const store: RateLimitStore = {
    /**
     * Initialize store with window duration
     */
    init(ms: number): void {
      windowMs = ms
    },

    /**
     * Increment counter for key.
     *
     * Internally stores entries with 2x windowMs for sliding window support.
     * Returns the logical 1x reset time to callers.
     *
     * **Note:** This is a non-atomic read-then-write operation. Under high
     * concurrency with shared storage, lost updates are possible.
     * See the module-level warning for details.
     */
    async increment(key: string, cost = 1): Promise<StoreResult> {
      const fullKey = getKey(key)
      const now = Date.now()

      // Get existing entry
      const existing = await storage.getItem<StoredEntry>(fullKey)

      if (existing && existing.reset > now) {
        // Increment existing entry — use remaining TTL instead of full TTL
        const updated: StoredEntry = {
          count: existing.count + cost,
          reset: existing.reset,
        }
        await storage.setItem(fullKey, updated, {
          ttl: getRemainingTtlSeconds(existing.reset),
        })
        return { count: updated.count, reset: updated.reset - windowMs }
      }

      // Create new entry (store with 2x windowMs so sliding window can read previous window)
      const internalReset = now + windowMs * 2
      const externalReset = now + windowMs
      const entry: StoredEntry = { count: cost, reset: internalReset }
      await storage.setItem(fullKey, entry, {
        ttl: getNewEntryTtlSeconds(),
      })
      return { count: 1, reset: externalReset }
    },

    /**
     * Get current state for key.
     *
     * Returns the logical 1x reset time (internal stores 2x for sliding window).
     */
    async get(key: string): Promise<StoreResult | undefined> {
      const fullKey = getKey(key)
      const entry = await storage.getItem<StoredEntry>(fullKey)

      if (!entry || entry.reset <= Date.now()) {
        return undefined
      }

      return { count: entry.count, reset: entry.reset - windowMs }
    },

    /**
     * Decrement counter for key
     */
    async decrement(key: string): Promise<void> {
      const fullKey = getKey(key)
      const entry = await storage.getItem<StoredEntry>(fullKey)

      if (entry && entry.count > 0) {
        const updated: StoredEntry = {
          count: entry.count - 1,
          reset: entry.reset,
        }
        await storage.setItem(fullKey, updated, {
          ttl: getRemainingTtlSeconds(entry.reset),
        })
      }
    },

    /**
     * Reset a specific key
     */
    async resetKey(key: string): Promise<void> {
      const fullKey = getKey(key)
      await storage.removeItem(fullKey)
    },

    /**
     * Reset all rate limit keys
     */
    async resetAll(): Promise<void> {
      const keys = await storage.getKeys(prefix)
      await Promise.all(keys.map((key) => storage.removeItem(key)))
    },

    /**
     * Shutdown - no-op for unstorage (handled by storage instance)
     */
    shutdown(): void {
      // Storage cleanup is handled by the user's storage instance
    },
  }

  return store
}

// ============================================================================
// Convenience Factories
// ============================================================================

/**
 * Create a store from a Nuxt useStorage() instance.
 *
 * This is a convenience wrapper for Nuxt applications that want to use
 * the built-in storage layer.
 *
 * @param storage - Storage instance from useStorage()
 * @param prefix - Key prefix (default: 'ratelimit:')
 * @returns Rate limit store instance
 *
 * @example
 * ```ts
 * // server/middleware/ratelimit.ts
 * import { createNuxtStore } from '@jfungus/ratelimit-unstorage'
 * import { defineEventHandler } from 'h3'
 *
 * export default defineEventHandler((event) => {
 *   const storage = useStorage()
 *   const store = createNuxtStore(storage)
 *   // ...
 * })
 * ```
 */
export function createNuxtStore(storage: Storage, prefix = 'ratelimit:'): RateLimitStore {
  return createUnstorageStore({ storage, prefix })
}
