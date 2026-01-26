/**
 * Rate limiting server middleware for Nuxt
 */

import {
  type Algorithm,
  MemoryStore,
  type RateLimitStore,
  type StoreResult,
  checkRateLimit,
} from '@jf/ratelimit'
import { createError, defineEventHandler, getHeader, getRequestIP, setHeader } from 'h3'
import { useRuntimeConfig, useStorage } from '#imports'

interface RateLimitConfig {
  limit: number
  windowMs: number
  algorithm: Algorithm
  storage: string
  skip: string[]
  include?: string[]
  statusCode: number
  message: string
  headers: boolean
  keyGenerator: 'ip' | 'ip-ua' | 'custom'
  dryRun: boolean
}

// Store instances per storage key
const stores = new Map<string, RateLimitStore>()

/**
 * Get or create a store for the given storage configuration
 */
function getStore(config: RateLimitConfig): RateLimitStore {
  const storageKey = config.storage || 'memory'

  if (stores.has(storageKey)) {
    return stores.get(storageKey)!
  }

  // For memory storage, use MemoryStore
  if (storageKey === 'memory') {
    const store = new MemoryStore()
    store.init(config.windowMs)
    stores.set(storageKey, store)
    return store
  }

  // For other storage types, use Nuxt's useStorage with a proper adapter
  const store = createNuxtStorageStore(storageKey, config.windowMs)
  stores.set(storageKey, store)
  return store
}

/**
 * Create a rate limit store using Nuxt's useStorage.
 * This properly implements the RateLimitStore interface from @jf/ratelimit.
 */
function createNuxtStorageStore(storageKey: string, initialWindowMs: number): RateLimitStore {
  const storage = useStorage(storageKey)
  const prefix = 'ratelimit:'
  let windowMs = initialWindowMs

  /**
   * Get the full key with prefix
   */
  function getKey(key: string): string {
    return `${prefix}${key}`
  }

  /**
   * Calculate TTL in seconds (for drivers that support it)
   */
  function getTtlSeconds(): number {
    // Add 10% buffer to ensure key doesn't expire before window ends
    return Math.ceil((windowMs * 1.1) / 1000)
  }

  const store: RateLimitStore = {
    /**
     * Initialize store with window duration
     */
    init(ms: number): void {
      windowMs = ms
    },

    /**
     * Increment counter for key and return current state.
     * NOTE: This is the correct signature - only takes `key`, not `windowMs`.
     */
    async increment(key: string): Promise<StoreResult> {
      const fullKey = getKey(key)
      const now = Date.now()

      // Get existing entry
      const existing = await storage.getItem<{ count: number; reset: number }>(fullKey)

      if (existing && existing.reset > now) {
        // Increment existing entry
        const updated = {
          count: existing.count + 1,
          reset: existing.reset,
        }
        await storage.setItem(fullKey, updated, {
          ttl: getTtlSeconds(),
        })
        return { count: updated.count, reset: updated.reset }
      }

      // Create new entry
      const reset = now + windowMs
      const entry = { count: 1, reset }
      await storage.setItem(fullKey, entry, {
        ttl: getTtlSeconds(),
      })
      return { count: 1, reset }
    },

    /**
     * Get current state for key
     */
    async get(key: string): Promise<StoreResult | undefined> {
      const fullKey = getKey(key)
      const entry = await storage.getItem<{ count: number; reset: number }>(fullKey)

      if (!entry || entry.reset <= Date.now()) {
        return undefined
      }

      return { count: entry.count, reset: entry.reset }
    },

    /**
     * Decrement counter for key
     */
    async decrement(key: string): Promise<void> {
      const fullKey = getKey(key)
      const entry = await storage.getItem<{ count: number; reset: number }>(fullKey)

      if (entry && entry.count > 0) {
        const updated = {
          count: entry.count - 1,
          reset: entry.reset,
        }
        await storage.setItem(fullKey, updated, {
          ttl: getTtlSeconds(),
        })
      }
    },

    /**
     * Reset a specific key.
     * NOTE: Method name is `resetKey` to match RateLimitStore interface.
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
      await Promise.all(keys.map((k) => storage.removeItem(k)))
    },

    /**
     * Shutdown - no-op for Nuxt storage (handled by Nuxt)
     */
    shutdown(): void {
      // Storage cleanup is handled by Nuxt
    },
  }

  return store
}

/**
 * Generate a key for rate limiting based on the request
 */
function generateKey(
  event: Parameters<Parameters<typeof defineEventHandler>[0]>[0],
  keyGenerator: 'ip' | 'ip-ua' | 'custom',
): string {
  const ip =
    getHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() || getRequestIP(event) || 'unknown'

  if (keyGenerator === 'ip-ua') {
    const ua = getHeader(event, 'user-agent') || 'unknown'
    return `${ip}:${ua}`
  }

  return ip
}

/**
 * Check if a path matches any of the patterns
 */
function matchesPattern(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    // Simple glob matching
    if (pattern.endsWith('/**')) {
      const patternPrefix = pattern.slice(0, -3)
      return path.startsWith(patternPrefix)
    }
    if (pattern.includes('*')) {
      const regex = new RegExp(`^${pattern.replace(/\*/g, '.*').replace(/\//g, '\\/')}$`)
      return regex.test(path)
    }
    return path === pattern
  })
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig().rateLimit as RateLimitConfig

  if (!config) {
    return
  }

  const path = event.path

  // Check skip patterns
  if (config.skip && matchesPattern(path, config.skip)) {
    return
  }

  // Check include patterns
  if (config.include && !matchesPattern(path, config.include)) {
    return
  }

  const store = getStore(config)
  const key = generateKey(event, config.keyGenerator)

  const { allowed, info } = await checkRateLimit({
    store,
    key,
    limit: config.limit,
    windowMs: config.windowMs,
    algorithm: config.algorithm,
  })

  // Set rate limit headers
  if (config.headers) {
    setHeader(event, 'X-RateLimit-Limit', String(info.limit))
    setHeader(event, 'X-RateLimit-Remaining', String(info.remaining))
    setHeader(event, 'X-RateLimit-Reset', String(Math.ceil(info.reset / 1000)))
  }

  // Store info in event context for later use
  event.context.rateLimit = info

  if (!allowed && !config.dryRun) {
    setHeader(event, 'Retry-After', Math.ceil((info.reset - Date.now()) / 1000))

    throw createError({
      statusCode: config.statusCode,
      statusMessage: config.message,
    })
  }
})
