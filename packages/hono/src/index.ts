/**
 * @jfungus/ratelimit-hono - Rate limiting middleware for Hono
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
import type { Context, Env, MiddlewareHandler } from 'hono'

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
 * Common X-RateLimit-* headers used by GitHub, Twitter, and most APIs:
 * - `X-RateLimit-Limit`: max requests in window
 * - `X-RateLimit-Remaining`: remaining requests
 * - `X-RateLimit-Reset`: Unix timestamp (seconds) when window resets
 *
 * ## "draft-6"
 * IETF draft-06 format with individual RateLimit-* headers:
 * - `RateLimit-Policy`: policy description (e.g., `100;w=60`)
 * - `RateLimit-Limit`: max requests
 * - `RateLimit-Remaining`: remaining requests
 * - `RateLimit-Reset`: seconds until reset
 *
 * ## "draft-7"
 * IETF draft-07 format with combined RateLimit header:
 * - `RateLimit-Policy`: policy description
 * - `RateLimit`: combined (e.g., `limit=100, remaining=50, reset=30`)
 *
 * ## "standard"
 * Current IETF draft-08+ format with structured field values (RFC 9651):
 * - `RateLimit-Policy`: `"name";q=100;w=60`
 * - `RateLimit`: `"name";r=50;t=30`
 *
 * ## false
 * Disable all rate limit headers.
 *
 * @see https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/
 */
export type HeadersFormat =
  | 'legacy' // X-RateLimit-* headers (GitHub/Twitter style)
  | 'draft-6' // IETF draft-06: individual RateLimit-* headers
  | 'draft-7' // IETF draft-07: combined RateLimit header
  | 'standard' // IETF draft-08+: structured field format (current)
  | false // Disable headers

/**
 * Options that can be safely changed at runtime via `configure()`.
 *
 * Excludes `windowMs`, `algorithm`, and `store` because changing them
 * would break epoch-aligned keys, misinterpret existing entries, or
 * abandon all state.
 */
export type RateLimitRuntimeOptions<E extends Env = Env> = Omit<
  RateLimitOptions<E>,
  'windowMs' | 'algorithm' | 'store'
>

/**
 * Rate limiter middleware with runtime configuration support.
 */
export type RateLimiterMiddleware<E extends Env = Env> = MiddlewareHandler<E> & {
  /** Safely update rate limiter options at runtime. Throws if unsafe keys are provided. */
  configure: (updates: Partial<RateLimitRuntimeOptions<E>>) => void
}

/**
 * Store access interface exposed in context
 */
export type RateLimitStoreAccess = {
  /** Get rate limit info for a key. Returns undefined if key doesn't exist. */
  getKey: (
    key: string,
  ) =>
    | Promise<{ count: number; reset: number } | undefined>
    | { count: number; reset: number }
    | undefined
  /** Reset rate limit for a key */
  resetKey: (key: string) => void | Promise<void>
  /** Reset all rate limit entries (if supported by store) */
  resetAll?: () => void | Promise<void>
}

/**
 * Options for rate limit middleware
 */
export type RateLimitOptions<E extends Env = Env> = {
  /**
   * Maximum requests allowed in the time window.
   * @default 100
   */
  limit?: number | ((c: Context<E>) => number | Promise<number>)

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
   * @default IP address from headers
   */
  keyGenerator?: (c: Context<E>) => string | Promise<string>

  /**
   * Handler called when rate limit is exceeded.
   */
  handler?: (c: Context<E>, info: RateLimitInfo) => Response | Promise<Response>

  /**
   * HTTP header format to use.
   *
   * - "legacy": X-RateLimit-* headers (GitHub/Twitter style, default)
   * - "draft-6": IETF draft-06 individual headers
   * - "draft-7": IETF draft-07 combined header
   * - "standard": IETF draft-08+ structured fields (current spec)
   * - false: Disable headers
   *
   * @default 'legacy'
   */
  headers?: HeadersFormat

  /**
   * Policy identifier for IETF headers (draft-6+).
   * Used in RateLimit and RateLimit-Policy headers.
   * @default 'default'
   */
  identifier?: string

  /**
   * Quota unit for IETF standard headers.
   * Only included in "standard" format when not "requests".
   * @default 'requests'
   */
  quotaUnit?: QuotaUnit

  /**
   * Skip rate limiting for certain requests.
   */
  skip?: (c: Context<E>) => boolean | Promise<boolean>

  /**
   * Don't count successful (2xx) requests against limit.
   * @default false
   */
  skipSuccessfulRequests?: boolean

  /**
   * Don't count failed (4xx, 5xx) requests against limit.
   * @default false
   */
  skipFailedRequests?: boolean

  /**
   * Callback when a request is rate limited.
   */
  onRateLimited?: (c: Context<E>, info: RateLimitInfo) => void | Promise<void>

  /**
   * Behavior when store operations fail.
   *
   * - 'allow': Allow the request through (fail-open, default)
   * - 'deny': Block the request with 500 error (fail-closed)
   * - Function: Custom handler returning true to allow, false to deny
   *
   * @default 'allow'
   */
  onStoreError?: 'allow' | 'deny' | ((error: Error, c: Context<E>) => boolean | Promise<boolean>)

  /**
   * Dry-run mode: track rate limits but don't block requests.
   * Useful for monitoring and testing before enforcing limits.
   * Headers and callbacks are still set/called normally.
   * @default false
   */
  dryRun?: boolean
}

/**
 * Cloudflare Rate Limiting binding interface
 */
export type RateLimitBinding = {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}

/**
 * Options for Cloudflare Rate Limiting binding
 */
export type CloudflareRateLimitOptions<E extends Env = Env> = {
  /**
   * Cloudflare Rate Limiting binding from env
   */
  binding: RateLimitBinding | ((c: Context<E>) => RateLimitBinding)

  /**
   * Generate unique key for each client.
   */
  keyGenerator: (c: Context<E>) => string | Promise<string>

  /**
   * Handler called when rate limit is exceeded.
   */
  handler?: (c: Context<E>) => Response | Promise<Response>

  /**
   * Skip rate limiting for certain requests.
   */
  skip?: (c: Context<E>) => boolean | Promise<boolean>
}

// ============================================================================
// Context Variable Type Extension
// ============================================================================

declare module 'hono' {
  interface ContextVariableMap {
    rateLimit?: RateLimitInfo
    rateLimitStore?: RateLimitStoreAccess
  }
}

// ============================================================================
// Singleton Default Store
// ============================================================================

let defaultStore: MemoryStore | undefined
let unknownIPWarned = false

/**
 * Shutdown the default memory store.
 * Call this during graceful shutdown to clean up timers.
 *
 * @example
 * ```ts
 * import { shutdownDefaultStore } from '@jfungus/ratelimit-hono'
 *
 * process.on('SIGTERM', () => {
 *   shutdownDefaultStore()
 *   process.exit(0)
 * })
 * ```
 */
export function shutdownDefaultStore(): void {
  if (defaultStore) {
    defaultStore.shutdown()
    defaultStore = undefined
  }
}

// ============================================================================
// Header Generation
// ============================================================================

/**
 * Sanitize identifier for RFC 9651 structured field compliance.
 */
function sanitizeIdentifier(id: string): string {
  if (!id || typeof id !== 'string') {
    return 'default'
  }
  // RFC 9651 tokens: Only allow alphanumeric, underscore, hyphen, dot, colon, asterisk, slash
  // Must start with a letter
  const sanitized = id.replace(/[^a-zA-Z0-9_\-.:*/]/g, '-')
  if (!sanitized || !/^[a-zA-Z]/.test(sanitized)) {
    return 'default'
  }
  return sanitized
}

/**
 * Set rate limit response headers based on the configured format.
 */
function setHeaders(
  c: Context,
  info: RateLimitInfo,
  format: HeadersFormat,
  windowMs: number,
  identifier: string,
  quotaUnit: QuotaUnit,
): void {
  if (format === false) {
    return
  }

  const windowSeconds = Math.ceil(windowMs / 1000)
  const resetSeconds = Math.max(0, Math.ceil((info.reset - Date.now()) / 1000))
  const safeId = sanitizeIdentifier(identifier)

  switch (format) {
    case 'standard':
      // IETF draft-08+ (current): Structured field values per RFC 9651
      {
        let policy = `"${safeId}";q=${info.limit};w=${windowSeconds}`
        if (quotaUnit !== 'requests') {
          policy += `;qu="${quotaUnit}"`
        }
        c.header('RateLimit-Policy', policy)
        c.header('RateLimit', `"${safeId}";r=${info.remaining};t=${resetSeconds}`)
      }
      break

    case 'draft-7':
      // IETF draft-07: Combined RateLimit header with comma-separated values
      c.header('RateLimit-Policy', `${info.limit};w=${windowSeconds}`)
      c.header(
        'RateLimit',
        `limit=${info.limit}, remaining=${info.remaining}, reset=${resetSeconds}`,
      )
      break

    case 'draft-6':
      // IETF draft-06: Individual RateLimit-* headers
      c.header('RateLimit-Policy', `${info.limit};w=${windowSeconds}`)
      c.header('RateLimit-Limit', String(info.limit))
      c.header('RateLimit-Remaining', String(info.remaining))
      c.header('RateLimit-Reset', String(resetSeconds))
      break
    default:
      // Common X-RateLimit-* headers (GitHub, Twitter, most APIs)
      // Uses Unix timestamp for reset (seconds since epoch)
      c.header('X-RateLimit-Limit', String(info.limit))
      c.header('X-RateLimit-Remaining', String(info.remaining))
      c.header('X-RateLimit-Reset', String(Math.ceil(info.reset / 1000)))
      break
  }
}

/**
 * Build headers object for rate limit responses.
 */
function buildRateLimitHeaders(
  info: RateLimitInfo,
  format: HeadersFormat,
  windowMs: number,
  identifier: string,
  quotaUnit: QuotaUnit,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
    'Retry-After': String(Math.max(0, Math.ceil((info.reset - Date.now()) / 1000))),
  }

  if (format === false) {
    return headers
  }

  const windowSeconds = Math.ceil(windowMs / 1000)
  const resetSeconds = Math.max(0, Math.ceil((info.reset - Date.now()) / 1000))
  const safeId = sanitizeIdentifier(identifier)

  switch (format) {
    case 'standard': {
      let policy = `"${safeId}";q=${info.limit};w=${windowSeconds}`
      if (quotaUnit !== 'requests') {
        policy += `;qu="${quotaUnit}"`
      }
      headers['RateLimit-Policy'] = policy
      headers.RateLimit = `"${safeId}";r=${info.remaining};t=${resetSeconds}`
      break
    }
    case 'draft-7':
      headers['RateLimit-Policy'] = `${info.limit};w=${windowSeconds}`
      headers.RateLimit = `limit=${info.limit}, remaining=${info.remaining}, reset=${resetSeconds}`
      break
    case 'draft-6':
      headers['RateLimit-Policy'] = `${info.limit};w=${windowSeconds}`
      headers['RateLimit-Limit'] = String(info.limit)
      headers['RateLimit-Remaining'] = String(info.remaining)
      headers['RateLimit-Reset'] = String(resetSeconds)
      break
    default:
      headers['X-RateLimit-Limit'] = String(info.limit)
      headers['X-RateLimit-Remaining'] = String(info.remaining)
      headers['X-RateLimit-Reset'] = String(Math.ceil(info.reset / 1000))
      break
  }

  return headers
}

// ============================================================================
// Default Key Generator
// ============================================================================

/**
 * Extract client IP address from request headers.
 *
 * Checks headers in order of reliability:
 * 1. `CF-Connecting-IP` - Cloudflare's true client IP
 * 2. `X-Real-IP` - Common proxy header (nginx)
 * 3. `X-Forwarded-For` - Standard proxy header (first IP only)
 *
 * @param c - Hono context
 * @returns Client IP address or 'unknown' if not found
 *
 * @warning These headers can be spoofed. Only trust them behind a reverse proxy.
 */
export function getClientIP(c: Context, ipv6Subnet: number | false = 56): string {
  // Platform-specific headers (most reliable)
  let ip: string | undefined

  ip = c.req.header('cf-connecting-ip')
  if (!ip) ip = c.req.header('x-real-ip')
  if (!ip) {
    const xff = c.req.header('x-forwarded-for')
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
// Default Handler
// ============================================================================

/**
 * Create the default 429 response for rate-limited requests.
 */
function createDefaultResponse(
  info: RateLimitInfo,
  format: HeadersFormat,
  windowMs: number,
  identifier: string,
  quotaUnit: QuotaUnit,
): Response {
  const headers = buildRateLimitHeaders(info, format, windowMs, identifier, quotaUnit)

  return new Response('Rate limit exceeded', {
    status: 429,
    headers,
  })
}

// ============================================================================
// Main Middleware
// ============================================================================

/**
 * Rate Limit Middleware for Hono.
 *
 * @param {RateLimitOptions} [options] - Configuration options
 * @returns {MiddlewareHandler} Middleware handler
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { rateLimiter } from '@jfungus/ratelimit-hono'
 *
 * const app = new Hono()
 *
 * // Basic usage - 60 requests per minute
 * app.use(rateLimiter())
 *
 * // Custom configuration
 * app.use('/api/*', rateLimiter({
 *   limit: 100,
 *   windowMs: 60 * 1000,
 * }))
 * ```
 */
export const rateLimiter = <E extends Env = Env>(
  options?: RateLimitOptions<E>,
): RateLimiterMiddleware<E> => {
  // Merge with defaults
  const opts = {
    limit: 100 as number | ((c: Context<E>) => number | Promise<number>),
    windowMs: 60_000,
    algorithm: 'sliding-window' as Algorithm,
    store: undefined as RateLimitStore | undefined,
    keyGenerator: getClientIP as (c: Context<E>) => string | Promise<string>,
    handler: undefined as
      | ((c: Context<E>, info: RateLimitInfo) => Response | Promise<Response>)
      | undefined,
    headers: 'legacy' as HeadersFormat,
    identifier: 'default',
    quotaUnit: 'requests' as QuotaUnit,
    skip: undefined as ((c: Context<E>) => boolean | Promise<boolean>) | undefined,
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    onRateLimited: undefined as
      | ((c: Context<E>, info: RateLimitInfo) => void | Promise<void>)
      | undefined,
    onStoreError: 'allow' as
      | 'allow'
      | 'deny'
      | ((error: Error, c: Context<E>) => boolean | Promise<boolean>),
    dryRun: false,
    ...options,
  }

  // Validate configuration
  if (typeof opts.limit === 'number' && opts.limit <= 0) {
    throw new Error(`[@jfungus/ratelimit-hono] limit must be a positive number, got: ${opts.limit}`)
  }
  if (opts.windowMs <= 0) {
    throw new Error(
      `[@jfungus/ratelimit-hono] windowMs must be a positive number, got: ${opts.windowMs}`,
    )
  }

  // Use default store if none provided
  const store = opts.store ?? (defaultStore ??= new MemoryStore())

  // Track initialization
  let initPromise: Promise<void> | null = null

  /**
   * Handle store errors based on configuration.
   * @returns true to allow request, false to deny
   */
  async function handleStoreError(error: Error, c: Context<E>): Promise<boolean> {
    if (typeof opts.onStoreError === 'function') {
      return opts.onStoreError(error, c)
    }
    // Default: fail-open (allow request through)
    return opts.onStoreError === 'allow'
  }

  const unsafeKeys = ['windowMs', 'algorithm', 'store'] as const

  const middleware = async function rateLimiterMiddleware(
    c: Context<E>,
    next: () => Promise<void>,
  ) {
    // Initialize store on first request (with proper locking)
    if (!initPromise && store.init) {
      const result = store.init(opts.windowMs)
      // Handle both sync and async init
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
          c,
        )
        if (shouldAllow) {
          return next()
        }
        return new Response('Rate limiter initialization failed', {
          status: 500,
        })
      }
    }

    // Check if should skip
    if (opts.skip) {
      const shouldSkip = await opts.skip(c)
      if (shouldSkip) {
        return next()
      }
    }

    // Generate key
    const key = await opts.keyGenerator(c)

    // Get limit (may be dynamic)
    const limit = typeof opts.limit === 'function' ? await opts.limit(c) : opts.limit

    // Check rate limit with error handling
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
        c,
      )
      if (shouldAllow) {
        return next()
      }
      return new Response('Rate limiter error', { status: 500 })
    }

    // Set context variable for downstream middleware
    c.set('rateLimit', info)

    // Expose store access in context
    c.set('rateLimitStore', {
      getKey: store.get?.bind(store) ?? (() => undefined),
      resetKey: store.resetKey.bind(store),
      resetAll: store.resetAll?.bind(store),
    })

    // Set headers
    setHeaders(c, info, opts.headers, opts.windowMs, opts.identifier, opts.quotaUnit)

    // Handle rate limited
    if (!allowed) {
      // Fire callback (always, even in dry-run mode for monitoring)
      if (opts.onRateLimited) {
        await opts.onRateLimited(c, info)
      }

      // In dry-run mode, allow the request through but still set headers
      if (!opts.dryRun) {
        // Custom handler or default
        if (opts.handler) {
          return opts.handler(c, info)
        }
        return createDefaultResponse(
          info,
          opts.headers,
          opts.windowMs,
          opts.identifier,
          opts.quotaUnit,
        )
      }
    }

    // Capture the window key BEFORE calling next() to ensure we decrement
    // the same window we incremented, even if next() takes a long time
    let windowKeyForDecrement: string | undefined
    if (opts.skipSuccessfulRequests || opts.skipFailedRequests) {
      const windowStart = Math.floor(Date.now() / opts.windowMs) * opts.windowMs
      windowKeyForDecrement = `${key}:${windowStart}`
    }

    // Continue
    await next()

    // Handle skip options after response
    if (windowKeyForDecrement && store.decrement) {
      const status = c.res.status
      const shouldDecrement =
        (opts.skipSuccessfulRequests && status >= 200 && status < 300) ||
        (opts.skipFailedRequests && status >= 400)

      if (shouldDecrement) {
        try {
          await store.decrement(windowKeyForDecrement)
        } catch {
          // Ignore decrement errors - request already processed
        }
      }
    }
  } as RateLimiterMiddleware<E>

  middleware.configure = (updates: Partial<RateLimitRuntimeOptions<E>>) => {
    for (const key of unsafeKeys) {
      if (key in updates) {
        throw new Error(
          `[@jfungus/ratelimit-hono] Cannot change '${key}' at runtime. This would break existing rate limit state.`,
        )
      }
    }
    // Validate limit if provided
    if ('limit' in updates && typeof updates.limit === 'number' && updates.limit <= 0) {
      throw new Error(
        `[@jfungus/ratelimit-hono] limit must be a positive number, got: ${updates.limit}`,
      )
    }
    Object.assign(opts, updates)
  }

  return middleware
}

// ============================================================================
// Cloudflare Rate Limiting Binding Middleware
// ============================================================================

/**
 * Rate limiter using Cloudflare's built-in Rate Limiting binding.
 *
 * This uses Cloudflare's globally distributed rate limiting infrastructure,
 * which is ideal for high-traffic applications.
 *
 * @example
 * ```ts
 * import { cloudflareRateLimiter } from '@jfungus/ratelimit-hono'
 *
 * type Bindings = { RATE_LIMITER: RateLimitBinding }
 *
 * const app = new Hono<{ Bindings: Bindings }>()
 *
 * app.use(cloudflareRateLimiter({
 *   binding: (c) => c.env.RATE_LIMITER,
 *   keyGenerator: (c) => c.req.header('cf-connecting-ip') ?? 'unknown',
 * }))
 * ```
 */
export const cloudflareRateLimiter = <E extends Env = Env>(
  options: CloudflareRateLimitOptions<E>,
): MiddlewareHandler<E> => {
  const { binding, keyGenerator, handler, skip } = options

  return async function cloudflareRateLimiterMiddleware(c, next) {
    // Check if should skip
    if (skip) {
      const shouldSkip = await skip(c)
      if (shouldSkip) {
        return next()
      }
    }

    // Get binding (may be dynamic)
    const rateLimitBinding = typeof binding === 'function' ? binding(c) : binding

    // Generate key
    const key = await keyGenerator(c)

    // Check rate limit
    const { success } = await rateLimitBinding.limit({ key })

    if (!success) {
      if (handler) {
        return handler(c)
      }
      return new Response('Rate limit exceeded', {
        status: 429,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return next()
  }
}
