/**
 * @jfungus/ratelimit-express - Rate limiting middleware for Express
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
import type { NextFunction, Request, RequestHandler, Response } from 'express'

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
 * Options for rate limit middleware
 */
export type RateLimitOptions = {
  /**
   * Maximum requests allowed in the time window.
   * @default 100
   */
  limit?: number | ((req: Request) => number | Promise<number>)

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
  keyGenerator?: (req: Request) => string | Promise<string>

  /**
   * Handler called when rate limit is exceeded.
   */
  handler?: (req: Request, res: Response, info: RateLimitInfo) => void | Promise<void>

  /**
   * HTTP header format to use.
   *
   * - "legacy": X-RateLimit-* headers (GitHub/Twitter style, default)
   * - "draft-6": IETF draft-06 individual headers
   * - "draft-7": IETF draft-07 combined header
   * - "standard": IETF draft-08+ structured fields (current spec)
   * - false: Disable headers
   *
   * When set, overrides `legacyHeaders` and `standardHeaders`.
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
  skip?: (req: Request) => boolean | Promise<boolean>

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
  onRateLimited?: (req: Request, res: Response, info: RateLimitInfo) => void | Promise<void>

  /**
   * Behavior when store operations fail.
   * @default 'allow'
   */
  onStoreError?: 'allow' | 'deny' | ((error: Error, req: Request) => boolean | Promise<boolean>)

  /**
   * Dry-run mode: track rate limits but don't block requests.
   * @default false
   */
  dryRun?: boolean

  /**
   * Use legacy headers (X-RateLimit-*).
   * @deprecated Use `headers: 'legacy'` instead.
   * @default true
   */
  legacyHeaders?: boolean

  /**
   * Use standard headers (RateLimit-*).
   * @deprecated Use `headers: 'draft-6'` instead.
   * @default false
   */
  standardHeaders?: boolean
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
 * Rate limiter middleware with runtime configuration support.
 */
export type RateLimiterMiddleware = RequestHandler & {
  /** Safely update rate limiter options at runtime. Throws if unsafe keys are provided. */
  configure: (updates: Partial<RateLimitRuntimeOptions>) => void
}

// ============================================================================
// Extend Express types
// ============================================================================

declare global {
  namespace Express {
    interface Request {
      rateLimit?: RateLimitInfo
    }
  }
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
 * Extract client IP address from Express request.
 */
export function getClientIP(req: Request, ipv6Subnet: number | false = 56): string {
  // Trust proxy setting
  let ip: string | undefined = req.ip

  if (!ip) ip = req.get('cf-connecting-ip')
  if (!ip) ip = req.get('x-real-ip')
  if (!ip) {
    const xff = req.get('x-forwarded-for')
    if (xff) ip = xff.split(',')[0].trim()
  }
  if (!ip) ip = req.socket?.remoteAddress

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
  res: Response,
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
      res.setHeader('RateLimit-Policy', policy)
      res.setHeader('RateLimit', `"${safeId}";r=${info.remaining};t=${resetSeconds}`)
      break
    }
    case 'draft-7':
      res.setHeader('RateLimit-Policy', `${info.limit};w=${windowSeconds}`)
      res.setHeader(
        'RateLimit',
        `limit=${info.limit}, remaining=${info.remaining}, reset=${resetSeconds}`,
      )
      break
    case 'draft-6':
      res.setHeader('RateLimit-Policy', `${info.limit};w=${windowSeconds}`)
      res.setHeader('RateLimit-Limit', String(info.limit))
      res.setHeader('RateLimit-Remaining', String(info.remaining))
      res.setHeader('RateLimit-Reset', String(resetSeconds))
      break
    default:
      // Legacy: X-RateLimit-* headers (GitHub/Twitter style)
      res.setHeader('X-RateLimit-Limit', String(info.limit))
      res.setHeader('X-RateLimit-Remaining', String(info.remaining))
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(info.reset / 1000)))
      break
  }
}

/**
 * Resolve the effective header format from options.
 *
 * If `headers` is explicitly set, it takes precedence.
 * Otherwise, falls back to legacy boolean behavior:
 * - `standardHeaders: true` → 'draft-6'
 * - `legacyHeaders: false` + no standardHeaders → false (disabled)
 * - Default → 'legacy'
 */
function resolveHeadersFormat(opts: {
  headers?: HeadersFormat
  legacyHeaders?: boolean
  standardHeaders?: boolean
}): HeadersFormat {
  // Explicit headers option takes priority
  if (opts.headers !== undefined) return opts.headers

  // Legacy boolean compat
  if (opts.standardHeaders) return 'draft-6'
  if (opts.legacyHeaders === false) return false
  return 'legacy'
}

// ============================================================================
// Main Middleware
// ============================================================================

/**
 * Create rate limit middleware for Express.
 *
 * @param options - Configuration options
 * @returns Express middleware
 *
 * @example
 * ```ts
 * import express from 'express'
 * import { rateLimiter } from '@jfungus/ratelimit-express'
 *
 * const app = express()
 *
 * // Global rate limit
 * app.use(rateLimiter({
 *   limit: 100,
 *   windowMs: 60 * 1000,
 * }))
 *
 * // Route-specific rate limit
 * app.post('/api/login', rateLimiter({ limit: 5, windowMs: 60_000 }), (req, res) => {
 *   // Handle login
 * })
 * ```
 */
export function rateLimiter(options?: RateLimitOptions): RateLimiterMiddleware {
  const opts = {
    limit: 100 as number | ((req: Request) => number | Promise<number>),
    windowMs: 60_000,
    algorithm: 'sliding-window' as Algorithm,
    store: undefined as RateLimitStore | undefined,
    keyGenerator: getClientIP,
    handler: undefined as
      | ((req: Request, res: Response, info: RateLimitInfo) => void | Promise<void>)
      | undefined,
    headers: undefined as HeadersFormat | undefined,
    identifier: 'default',
    quotaUnit: 'requests' as QuotaUnit,
    skip: undefined as ((req: Request) => boolean | Promise<boolean>) | undefined,
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    onRateLimited: undefined as
      | ((req: Request, res: Response, info: RateLimitInfo) => void | Promise<void>)
      | undefined,
    onStoreError: 'allow' as
      | 'allow'
      | 'deny'
      | ((error: Error, req: Request) => boolean | Promise<boolean>),
    dryRun: false,
    legacyHeaders: true as boolean | undefined,
    standardHeaders: false as boolean | undefined,
    ...options,
  }

  // Validate
  if (typeof opts.limit === 'number' && opts.limit <= 0) {
    throw new Error('[@jfungus/ratelimit-express] limit must be a positive number')
  }
  if (opts.windowMs <= 0) {
    throw new Error('[@jfungus/ratelimit-express] windowMs must be a positive number')
  }

  // Use default store if none provided
  const store = opts.store ?? (defaultStore ??= new MemoryStore())

  // Track initialization
  let initPromise: Promise<void> | null = null

  async function handleStoreError(error: Error, req: Request): Promise<boolean> {
    if (typeof opts.onStoreError === 'function') {
      return opts.onStoreError(error, req)
    }
    return opts.onStoreError === 'allow'
  }

  const unsafeKeys = ['windowMs', 'algorithm', 'store'] as const

  // First-request validation (runs once, then disables itself)
  let validated = false

  const middleware = async function rateLimiterMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!validated) {
      validated = true
      // Warn if trust proxy is not set and req.ip is undefined
      if (!req.ip && !req.app?.get?.('trust proxy')) {
        console.warn(
          '[@jfungus/ratelimit-express] req.ip is undefined. If your app is behind a reverse proxy, set "trust proxy" in Express (e.g., app.set(\'trust proxy\', 1)). Without it, IP-based rate limiting may not work correctly.',
        )
      }
    }

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
          req,
        )
        if (shouldAllow) {
          return next()
        }
        res.status(500).send('Rate limiter initialization failed')
        return
      }
    }

    // Check skip
    if (opts.skip) {
      const shouldSkip = await opts.skip(req)
      if (shouldSkip) {
        return next()
      }
    }

    // Generate key
    const key = await opts.keyGenerator(req)

    // Get limit
    const limit = typeof opts.limit === 'function' ? await opts.limit(req) : opts.limit

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
        req,
      )
      if (shouldAllow) {
        return next()
      }
      res.status(500).send('Rate limiter error')
      return
    }

    // Store info in request
    req.rateLimit = info

    // Set headers
    const headersFormat = resolveHeadersFormat(opts)
    setRateLimitHeaders(res, info, headersFormat, opts.windowMs, opts.identifier, opts.quotaUnit)

    // Handle rate limited
    if (!allowed) {
      if (opts.onRateLimited) {
        await opts.onRateLimited(req, res, info)
      }

      if (!opts.dryRun) {
        res.setHeader('Retry-After', String(Math.ceil((info.reset - Date.now()) / 1000)))

        if (opts.handler) {
          await opts.handler(req, res, info)
          return
        }

        res.status(429).send('Rate limit exceeded')
        return
      }
    }

    // Handle skip after response
    if (opts.skipSuccessfulRequests || opts.skipFailedRequests) {
      const windowStart = Math.floor(Date.now() / opts.windowMs) * opts.windowMs
      const windowKey = `${key}:${windowStart}`

      res.on('finish', async () => {
        const status = res.statusCode
        const shouldDecrement =
          (opts.skipSuccessfulRequests && status >= 200 && status < 300) ||
          (opts.skipFailedRequests && status >= 400)

        if (shouldDecrement && store.decrement) {
          try {
            await store.decrement(windowKey)
          } catch {
            // Ignore
          }
        }
      })
    }

    next()
  } as RateLimiterMiddleware

  middleware.configure = (updates: Partial<RateLimitRuntimeOptions>) => {
    for (const key of unsafeKeys) {
      if (key in updates) {
        throw new Error(
          `[@jfungus/ratelimit-express] Cannot change '${key}' at runtime. This would break existing rate limit state.`,
        )
      }
    }
    // Validate limit if provided
    if ('limit' in updates && typeof updates.limit === 'number' && updates.limit <= 0) {
      throw new Error(
        `[@jfungus/ratelimit-express] limit must be a positive number, got: ${updates.limit}`,
      )
    }
    Object.assign(opts, updates)
  }

  return middleware
}
