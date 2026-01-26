/**
 * Rate limiting server middleware for Nuxt
 */

import { type Algorithm, MemoryStore, type RateLimitStore, checkRateLimit } from '@jf/ratelimit'
import { defineEventHandler, getHeader, getRequestIP, setHeader } from 'h3'
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

  // For other storage types, use Nuxt's useStorage with a wrapper
  const store = createNuxtStorageStore(storageKey, config.windowMs)
  stores.set(storageKey, store)
  return store
}

/**
 * Create a rate limit store using Nuxt's useStorage
 */
function createNuxtStorageStore(storageKey: string, _windowMs: number): RateLimitStore {
  const storage = useStorage(storageKey)
  const prefix = 'ratelimit:'

  return {
    async get(key: string) {
      const data = await storage.getItem<{
        count: number
        reset: number
      }>(`${prefix}${key}`)
      return data || null
    },

    async set(key: string, value: { count: number; reset: number }) {
      const ttl = Math.max(0, Math.ceil((value.reset - Date.now()) / 1000))
      await storage.setItem(`${prefix}${key}`, value, {
        ttl: ttl > 0 ? ttl : undefined,
      })
    },

    async increment(key: string, windowMs: number) {
      const now = Date.now()
      const data = await storage.getItem<{
        count: number
        reset: number
      }>(`${prefix}${key}`)

      let count: number
      let reset: number

      if (data && data.reset > now) {
        count = data.count + 1
        reset = data.reset
      } else {
        count = 1
        reset = now + windowMs
      }

      const ttl = Math.max(0, Math.ceil((reset - now) / 1000))
      await storage.setItem(`${prefix}${key}`, { count, reset }, { ttl: ttl > 0 ? ttl : undefined })

      return { count, reset }
    },

    async reset(key: string) {
      await storage.removeItem(`${prefix}${key}`)
    },
  }
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
      const prefix = pattern.slice(0, -3)
      return path.startsWith(prefix)
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

// Helper to create error (H3 utility)
function createError(opts: { statusCode: number; statusMessage: string }) {
  const error = new Error(opts.statusMessage) as Error & {
    statusCode: number
    statusMessage: string
  }
  error.statusCode = opts.statusCode
  error.statusMessage = opts.statusMessage
  return error
}
