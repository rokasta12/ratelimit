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
  maskIPv6,
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
  type StoreCheckResult,
  checkRateLimit,
  createRateLimiter,
  maskIPv6,
} from '@jfungus/ratelimit'

// ============================================================================
// Types
// ============================================================================

/**
 * Quota unit for IETF standard headers.
 * @see https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/
 */
export type QuotaUnit = 'requests' | 'content-bytes' | 'concurrent-requests'

/**
 * Header format options.
 *
 * ## "legacy" (default)
 * Common X-RateLimit-* headers used by GitHub, Twitter, and most APIs.
 *
 * ## "draft-6"
 * IETF draft-06 format with individual RateLimit-* headers.
 *
 * ## "draft-7"
 * IETF draft-07 format with combined RateLimit header.
 *
 * ## "standard"
 * Current IETF draft-08+ format with structured field values (RFC 9651).
 *
 * ## false
 * Disable all rate limit headers.
 */
export type HeadersFormat =
  | 'legacy'
  | 'draft-6'
  | 'draft-7'
  | 'standard'
  | false

/**
 * Store access interface exposed in event context
 */
export type RateLimitStoreAccess = {
  getKey: (
    key: string,
  ) =>
    | Promise<{ count: number; reset: number } | undefined>
    | { count: number; reset: number }
    | undefined
  resetKey: (key: string) => void | Promise<void>
  resetAll?: () => void | Promise<void>
}

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
   * HTTP header format to use.
   * @default 'legacy'
   */
  headers?: HeadersFormat

  /**
   * Policy identifier for IETF headers (draft-6+).
   * @default 'default'
   */
  identifier?: string

  /**
   * Quota unit for IETF standard headers.
   * @default 'requests'
   */
  quotaUnit?: QuotaUnit

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

/**
 * Options that can be safely changed at runtime via `configure()`.
 *
 * Excludes `windowMs`, `algorithm`, and `store` because changing them
 * would break epoch-aligned keys, misinterpret existing entries, or
 * abandon all state.
 */
export type RateLimitRuntimeOptions = Omit<
  RateLimitOptions,
  'windowMs' | 'algorithm' | 'store'
>

/**
 * Rate limiter handler with runtime configuration support.
 */
export type RateLimiterHandler = EventHandler & {
  /** Safely update rate limiter options at runtime. Throws if unsafe keys are provided. */
  configure: (updates: Partial<RateLimitRuntimeOptions>) => void
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
export function getClientIP(event: H3Event, ipv6Subnet: number | false = 56): string {
  // Try H3's built-in IP detection first
  let ip: string | undefined = getRequestIP(event, { xForwardedFor: true }) ?? undefined

  if (!ip) ip = getHeader(event, 'cf-connecting-ip')
  if (!ip) ip = getHeader(event, 'x-real-ip')
  if (!ip) {
    const xff = getHeader(event, 'x-forwarded-for')
    if (xff) ip = xff.split(',')[0].trim()
  }

  if (!ip) {
    if (!unknownIPWarned) {
      unknownIPWarned = true
      console.warn(
        '[@jfungus/ratelimit] Could not determine client IP address. All unidentified clients share a single rate limit bucket. Ensure your reverse proxy sets X-Forwarded-For or X-Real-IP headers.',
      )
    }
    return 'unknown'
  }

  return maskIPv6(ip, ipv6Subnet)
}

// ============================================================================
// Header Generation
// ============================================================================

/**
 * Sanitize identifier for RFC 9651 structured field compliance.
 */
function sanitizeIdentifier(id: string): string {
  if (!id || typeof id !== 'string') return 'default'
  const sanitized = id.replace(/[^a-zA-Z0-9_\-.:*/]/g, '-')
  if (!sanitized || !/^[a-zA-Z]/.test(sanitized)) return 'default'
  return sanitized
}

/**
 * Set rate limit response headers based on the configured format.
 */
function setRateLimitHeaders(
  event: H3Event,
  info: RateLimitInfo,
  format: HeadersFormat,
  windowMs: number,
  identifier: string,
  quotaUnit: QuotaUnit,
): void {
  if (format === false) return

  const windowSeconds = Math.ceil(windowMs / 1000)
  const resetSeconds = Math.max(0, Math.ceil((info.reset - Date.now()) / 1000))
  const safeId = sanitizeIdentifier(identifier)

  switch (format) {
    case 'standard': {
      let policy = `"${safeId}";q=${info.limit};w=${windowSeconds}`
      if (quotaUnit !== 'requests') {
        policy += `;qu="${quotaUnit}"`
      }
      setHeader(event, 'RateLimit-Policy', policy)
      setHeader(event, 'RateLimit', `"${safeId}";r=${info.remaining};t=${resetSeconds}`)
      break
    }
    case 'draft-7':
      setHeader(event, 'RateLimit-Policy', `${info.limit};w=${windowSeconds}`)
      setHeader(
        event,
        'RateLimit',
        `limit=${info.limit}, remaining=${info.remaining}, reset=${resetSeconds}`,
      )
      break
    case 'draft-6':
      setHeader(event, 'RateLimit-Policy', `${info.limit};w=${windowSeconds}`)
      setHeader(event, 'RateLimit-Limit', String(info.limit))
      setHeader(event, 'RateLimit-Remaining', String(info.remaining))
      setHeader(event, 'RateLimit-Reset', String(resetSeconds))
      break
    default:
      setHeader(event, 'X-RateLimit-Limit', String(info.limit))
      setHeader(event, 'X-RateLimit-Remaining', String(info.remaining))
      setHeader(event, 'X-RateLimit-Reset', String(Math.ceil(info.reset / 1000)))
      break
  }
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
export function rateLimiter(options?: RateLimitOptions): RateLimiterHandler {
  const opts = {
    limit: 100 as number | ((event: H3Event) => number | Promise<number>),
    windowMs: 60_000,
    algorithm: 'sliding-window' as Algorithm,
    store: undefined as RateLimitStore | undefined,
    keyGenerator: getClientIP,
    handler: undefined as
      | ((event: H3Event, info: RateLimitInfo) => void | Promise<void>)
      | undefined,
    headers: 'legacy' as HeadersFormat,
    identifier: 'default',
    quotaUnit: 'requests' as QuotaUnit,
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

  const unsafeKeys = ['windowMs', 'algorithm', 'store'] as const

  const handler = eventHandler(async function rateLimiterHandler(event: H3Event) {
    // Initialize store
    if (!initPromise && store.init) {
      const result = store.init(opts.windowMs)
      initPromise = result instanceof Promise ? result : Promise.resolve()
    }
    if (initPromise) {
      try {
        await initPromise
      } catch (error) {
        // Reset to allow retry on next request
        initPromise = null
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
    setRateLimitHeaders(event, info, opts.headers, opts.windowMs, opts.identifier, opts.quotaUnit)

    // Store info in event context
    event.context.rateLimit = info

    // Expose store access in event context
    event.context.rateLimitStore = {
      getKey: store.get?.bind(store) ?? (() => undefined),
      resetKey: store.resetKey.bind(store),
      resetAll: store.resetAll?.bind(store),
    }

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
  }) as RateLimiterHandler

  handler.configure = (updates: Partial<RateLimitRuntimeOptions>) => {
    for (const key of unsafeKeys) {
      if (key in updates) {
        throw new Error(
          `[@jfungus/ratelimit-h3] Cannot change '${key}' at runtime. This would break existing rate limit state.`,
        )
      }
    }
    // Validate limit if provided
    if ('limit' in updates && typeof updates.limit === 'number' && updates.limit <= 0) {
      throw new Error(
        `[@jfungus/ratelimit-h3] limit must be a positive number, got: ${updates.limit}`,
      )
    }
    Object.assign(opts, updates)
  }

  return handler
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
export function defineRateLimiter(options?: RateLimitOptions): RateLimiterHandler {
  return rateLimiter(options)
}
