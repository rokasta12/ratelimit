/**
 * @jfungus/ratelimit-h3 - Rate limiting middleware for H3/Nitro
 *
 * Works with H3, Nitro, and Nuxt server routes.
 *
 * @module
 */

import {
  type Algorithm,
  MemoryStore,
  type RateLimitInfo,
  type RateLimitStore,
  checkRateLimit,
} from '@jfungus/ratelimit'
import type { EventHandler, H3Event } from 'h3'
import { eventHandler, getHeader, getRequestIP, send, setHeader, setResponseStatus } from 'h3'

// Re-export core types
export {
  type Algorithm,
  MemoryStore,
  type RateLimitInfo,
  type RateLimitStore,
  type CheckRateLimitOptions,
  type CheckRateLimitResult,
  type StoreResult,
  checkRateLimit,
  createRateLimiter,
} from '@jfungus/ratelimit'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for rate limit middleware
 */
export type RateLimitOptions = {
  /**
   * Maximum requests allowed in the time window.
   * @default 100
   */
  limit?: number | ((event: H3Event) => number | Promise<number>)

  /**
   * Time window in milliseconds.
   * @default 60000 (1 minute)
   */
  windowMs?: number

  /**
   * Rate limiting algorithm.
   * @default 'sliding-window'
   */
  algorithm?: Algorithm

  /**
   * Storage backend for rate limit state.
   * @default MemoryStore
   */
  store?: RateLimitStore

  /**
   * Generate unique key for each client.
   * @default IP address
   */
  keyGenerator?: (event: H3Event) => string | Promise<string>

  /**
   * Handler called when rate limit is exceeded.
   */
  handler?: (event: H3Event, info: RateLimitInfo) => void | Promise<void>

  /**
   * Skip rate limiting for certain requests.
   */
  skip?: (event: H3Event) => boolean | Promise<boolean>

  /**
   * Callback when a request is rate limited.
   */
  onRateLimited?: (event: H3Event, info: RateLimitInfo) => void | Promise<void>

  /**
   * Behavior when store operations fail.
   * @default 'allow'
   */
  onStoreError?: 'allow' | 'deny' | ((error: Error, event: H3Event) => boolean | Promise<boolean>)

  /**
   * Dry-run mode: track rate limits but don't block requests.
   * @default false
   */
  dryRun?: boolean
}

// ============================================================================
// Singleton Default Store
// ============================================================================

let defaultStore: MemoryStore | undefined
let unknownIPWarned = false

/**
 * Shutdown the default memory store.
 */
export function shutdownDefaultStore(): void {
  if (defaultStore) {
    defaultStore.shutdown()
    defaultStore = undefined
  }
}

// ============================================================================
// Default Key Generator
// ============================================================================

/**
 * Extract client IP address from H3 event.
 */
export function getClientIP(event: H3Event): string {
  // Try H3's built-in IP detection first
  const ip = getRequestIP(event, { xForwardedFor: true })
  if (ip) {
    return ip
  }

  // Platform-specific headers
  const cfIP = getHeader(event, 'cf-connecting-ip')
  if (cfIP) {
    return cfIP
  }

  const xRealIP = getHeader(event, 'x-real-ip')
  if (xRealIP) {
    return xRealIP
  }

  const xff = getHeader(event, 'x-forwarded-for')
  if (xff) {
    return xff.split(',')[0].trim()
  }

  if (!unknownIPWarned) {
    unknownIPWarned = true
    console.warn(
      '[@jfungus/ratelimit] Could not determine client IP address. All unidentified clients share a single rate limit bucket. Ensure your reverse proxy sets X-Forwarded-For or X-Real-IP headers.',
    )
  }
  return 'unknown'
}

// ============================================================================
// Main Middleware
// ============================================================================

/**
 * Create rate limit middleware for H3/Nitro.
 *
 * @param options - Configuration options
 * @returns H3 event handler
 *
 * @example
 * ```ts
 * // server/middleware/ratelimit.ts
 * import { rateLimiter } from '@jfungus/ratelimit-h3'
 *
 * export default rateLimiter({
 *   limit: 100,
 *   windowMs: 60 * 1000,
 * })
 * ```
 *
 * @example Using with route-specific limits
 * ```ts
 * // server/api/expensive.post.ts
 * import { rateLimiter } from '@jfungus/ratelimit-h3'
 *
 * export default defineEventHandler({
 *   onRequest: [rateLimiter({ limit: 5, windowMs: 60_000 })],
 *   handler: async (event) => {
 *     // Handle request
 *   },
 * })
 * ```
 */
export function rateLimiter(options?: RateLimitOptions): EventHandler {
  const opts = {
    limit: 100 as number | ((event: H3Event) => number | Promise<number>),
    windowMs: 60_000,
    algorithm: 'sliding-window' as Algorithm,
    store: undefined as RateLimitStore | undefined,
    keyGenerator: getClientIP,
    handler: undefined as
      | ((event: H3Event, info: RateLimitInfo) => void | Promise<void>)
      | undefined,
    skip: undefined as ((event: H3Event) => boolean | Promise<boolean>) | undefined,
    onRateLimited: undefined as
      | ((event: H3Event, info: RateLimitInfo) => void | Promise<void>)
      | undefined,
    onStoreError: 'allow' as
      | 'allow'
      | 'deny'
      | ((error: Error, event: H3Event) => boolean | Promise<boolean>),
    dryRun: false,
    ...options,
  }

  // Validate
  if (typeof opts.limit === 'number' && opts.limit <= 0) {
    throw new Error('[@jfungus/ratelimit-h3] limit must be a positive number')
  }
  if (opts.windowMs <= 0) {
    throw new Error('[@jfungus/ratelimit-h3] windowMs must be a positive number')
  }

  // Use default store if none provided
  const store = opts.store ?? (defaultStore ??= new MemoryStore())

  // Track initialization
  let initPromise: Promise<void> | null = null

  async function handleStoreError(error: Error, event: H3Event): Promise<boolean> {
    if (typeof opts.onStoreError === 'function') {
      return opts.onStoreError(error, event)
    }
    return opts.onStoreError === 'allow'
  }

  return eventHandler(async function rateLimiterHandler(event: H3Event) {
    // Initialize store
    if (!initPromise && store.init) {
      const result = store.init(opts.windowMs)
      initPromise = result instanceof Promise ? result : Promise.resolve()
    }
    if (initPromise) {
      try {
        await initPromise
      } catch (error) {
        const shouldAllow = await handleStoreError(
          error instanceof Error ? error : new Error(String(error)),
          event,
        )
        if (!shouldAllow) {
          setResponseStatus(event, 500)
          return send(event, 'Rate limiter initialization failed')
        }
        return // Continue to next handler
      }
    }

    // Check skip
    if (opts.skip) {
      const shouldSkip = await opts.skip(event)
      if (shouldSkip) {
        return // Continue
      }
    }

    // Generate key
    const key = await opts.keyGenerator(event)

    // Get limit
    const limit = typeof opts.limit === 'function' ? await opts.limit(event) : opts.limit

    // Check rate limit
    let allowed: boolean
    let info: RateLimitInfo

    try {
      const result = await checkRateLimit({
        store,
        key,
        limit,
        windowMs: opts.windowMs,
        algorithm: opts.algorithm,
      })
      allowed = result.allowed
      info = result.info
    } catch (error) {
      const shouldAllow = await handleStoreError(
        error instanceof Error ? error : new Error(String(error)),
        event,
      )
      if (!shouldAllow) {
        setResponseStatus(event, 500)
        return send(event, 'Rate limiter error')
      }
      return // Continue
    }

    // Set headers
    setHeader(event, 'X-RateLimit-Limit', String(info.limit))
    setHeader(event, 'X-RateLimit-Remaining', String(info.remaining))
    setHeader(event, 'X-RateLimit-Reset', String(Math.ceil(info.reset / 1000)))

    // Store info in event context
    event.context.rateLimit = info

    // Handle rate limited
    if (!allowed) {
      if (opts.onRateLimited) {
        await opts.onRateLimited(event, info)
      }

      if (!opts.dryRun) {
        setResponseStatus(event, 429)
        setHeader(event, 'Retry-After', Math.ceil((info.reset - Date.now()) / 1000))

        if (opts.handler) {
          await opts.handler(event, info)
          return
        }

        return send(event, 'Rate limit exceeded')
      }
    }

    // Continue to next handler (return undefined)
  })
}

/**
 * Define rate limit middleware using defineEventHandler pattern.
 *
 * @example
 * ```ts
 * // server/middleware/ratelimit.ts
 * import { defineRateLimiter } from '@jfungus/ratelimit-h3'
 *
 * export default defineRateLimiter({
 *   limit: 100,
 *   windowMs: 60_000,
 * })
 * ```
 */
export function defineRateLimiter(options?: RateLimitOptions): EventHandler {
  return rateLimiter(options)
}
