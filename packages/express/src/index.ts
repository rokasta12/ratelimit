/**
 * @jf/ratelimit-express - Rate limiting middleware for Express
 *
 * @module
 */

import {
  type Algorithm,
  MemoryStore,
  type RateLimitInfo,
  type RateLimitStore,
  checkRateLimit,
} from '@jf/ratelimit'
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
  checkRateLimit,
  createRateLimiter,
} from '@jf/ratelimit'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for rate limit middleware
 */
export type RateLimitOptions = {
  /**
   * Maximum requests allowed in the time window.
   * @default 60
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
   * @default true
   */
  legacyHeaders?: boolean

  /**
   * Use standard headers (RateLimit-*).
   * @default false
   */
  standardHeaders?: boolean
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
export function getClientIP(req: Request): string {
  // Trust proxy setting
  const ip = req.ip
  if (ip) {
    return ip
  }

  // Check common headers
  const cfIP = req.get('cf-connecting-ip')
  if (cfIP) {
    return cfIP
  }

  const xRealIP = req.get('x-real-ip')
  if (xRealIP) {
    return xRealIP
  }

  const xff = req.get('x-forwarded-for')
  if (xff) {
    return xff.split(',')[0].trim()
  }

  return req.socket?.remoteAddress || 'unknown'
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
 * import { rateLimiter } from '@jf/ratelimit-express'
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
export function rateLimiter(options?: RateLimitOptions): RequestHandler {
  const opts = {
    limit: 60 as number | ((req: Request) => number | Promise<number>),
    windowMs: 60_000,
    algorithm: 'sliding-window' as Algorithm,
    store: undefined as RateLimitStore | undefined,
    keyGenerator: getClientIP,
    handler: undefined as
      | ((req: Request, res: Response, info: RateLimitInfo) => void | Promise<void>)
      | undefined,
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
    legacyHeaders: true,
    standardHeaders: false,
    ...options,
  }

  // Validate
  if (typeof opts.limit === 'number' && opts.limit <= 0) {
    throw new Error('[@jf/ratelimit-express] limit must be a positive number')
  }
  if (opts.windowMs <= 0) {
    throw new Error('[@jf/ratelimit-express] windowMs must be a positive number')
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

  return async function rateLimiterMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
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
    if (opts.legacyHeaders) {
      res.setHeader('X-RateLimit-Limit', String(info.limit))
      res.setHeader('X-RateLimit-Remaining', String(info.remaining))
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(info.reset / 1000)))
    }

    if (opts.standardHeaders) {
      const resetSeconds = Math.max(0, Math.ceil((info.reset - Date.now()) / 1000))
      res.setHeader('RateLimit-Limit', String(info.limit))
      res.setHeader('RateLimit-Remaining', String(info.remaining))
      res.setHeader('RateLimit-Reset', String(resetSeconds))
    }

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
  }
}
