/**
 * @jf/ratelimit-nuxt - Nuxt module for rate limiting
 *
 * Provides automatic rate limiting middleware for Nuxt applications.
 * Uses Nuxt's built-in `useStorage()` for distributed deployments.
 *
 * @module
 */

import { addServerHandler, createResolver, defineNuxtModule } from '@nuxt/kit'

// ============================================================================
// Types
// ============================================================================

/**
 * Rate limiting algorithm type.
 * Must match the Algorithm type from @jf/ratelimit core.
 */
export type Algorithm = 'fixed-window' | 'sliding-window'

export interface ModuleOptions {
  /**
   * Enable the rate limiting middleware.
   * @default true
   */
  enabled?: boolean

  /**
   * Maximum number of requests allowed in the window.
   * @default 100
   */
  limit?: number

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
   * Storage driver to use with useStorage().
   * If not set, uses in-memory storage (not suitable for multi-instance deployments).
   *
   * Set to 'memory' for development or single-instance.
   * Set to a storage key like 'redis' or 'kv' for production.
   *
   * @default 'memory'
   */
  storage?: string

  /**
   * Route patterns to skip rate limiting.
   * Supports glob patterns.
   *
   * @example ['/_nuxt/**', '/api/health']
   * @default ['/_nuxt/**', '/__nuxt_error']
   */
  skip?: string[]

  /**
   * Route patterns to apply rate limiting to.
   * If set, only these routes will be rate limited.
   *
   * @example ['/api/**']
   */
  include?: string[]

  /**
   * Response status code when rate limited.
   * @default 429
   */
  statusCode?: number

  /**
   * Response message when rate limited.
   * @default 'Too Many Requests'
   */
  message?: string

  /**
   * Whether to include rate limit headers in response.
   * @default true
   */
  headers?: boolean

  /**
   * Custom key generator for identifying clients.
   * By default uses X-Forwarded-For or remote address.
   */
  keyGenerator?: 'ip' | 'ip-ua' | 'custom'

  /**
   * Dry run mode - log rate limits but don't block requests.
   * @default false
   */
  dryRun?: boolean
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@jf/ratelimit-nuxt',
    configKey: 'rateLimit',
    compatibility: {
      nuxt: '^3.0.0',
    },
  },
  defaults: {
    enabled: true,
    limit: 100,
    windowMs: 60_000,
    algorithm: 'sliding-window',
    storage: 'memory',
    skip: ['/_nuxt/**', '/__nuxt_error'],
    statusCode: 429,
    message: 'Too Many Requests',
    headers: true,
    keyGenerator: 'ip',
    dryRun: false,
  },
  setup(options, nuxt) {
    if (!options.enabled) {
      return
    }

    const resolver = createResolver(import.meta.url)

    // Make options available at runtime
    nuxt.options.runtimeConfig.rateLimit = {
      limit: options.limit!,
      windowMs: options.windowMs!,
      algorithm: options.algorithm!,
      storage: options.storage!,
      skip: options.skip!,
      include: options.include,
      statusCode: options.statusCode!,
      message: options.message!,
      headers: options.headers!,
      keyGenerator: options.keyGenerator!,
      dryRun: options.dryRun!,
    }

    // Add the server middleware
    addServerHandler({
      handler: resolver.resolve('../runtime/server/middleware/ratelimit'),
      middleware: true,
    })
  },
})
