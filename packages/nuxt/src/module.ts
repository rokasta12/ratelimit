/**
 * @jfungus/ratelimit-nuxt - Nuxt module for rate limiting
 *
 * Provides automatic rate limiting middleware for Nuxt applications.
 * Uses Nuxt's built-in `useStorage()` for distributed deployments.
 *
 * @module
 */

import { addServerHandler, createResolver, defineNuxtModule } from '@nuxt/kit'
import { defu } from 'defu'

// Declare runtime config types to ensure Nuxt includes all fields
declare module 'nuxt/schema' {
  interface RuntimeConfig {
    rateLimit: {
      limit: number
      windowMs: number
      algorithm: string
      storage: string
      skip: string[]
      include: string[]
      routesJson: string
      statusCode: number
      message: string
      headers: boolean
      headerStyle: string
      keyGenerator: string
      dryRun: boolean
    }
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Rate limiting algorithm type.
 * Must match the Algorithm type from @jfungus/ratelimit core.
 */
export type Algorithm = 'fixed-window' | 'sliding-window'

/**
 * Header style for rate limit headers.
 * - 'legacy': X-RateLimit-* headers (default, widely supported)
 * - 'standard': RateLimit-* headers (IETF draft standard)
 * - 'both': Include both header styles
 */
export type HeaderStyle = 'legacy' | 'standard' | 'both'

/**
 * Per-route rate limit configuration
 */
export interface RouteRateLimitConfig {
  /**
   * Maximum number of requests allowed in the window.
   */
  limit: number

  /**
   * Time window in milliseconds.
   */
  windowMs: number

  /**
   * Rate limiting algorithm.
   * @default inherits from global config
   */
  algorithm?: Algorithm
}

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
   * Per-route rate limit configuration.
   * Routes are matched in order, first match wins.
   * Supports glob patterns.
   *
   * @example
   * ```ts
   * routes: {
   *   '/api/auth/**': { limit: 5, windowMs: 60000 },
   *   '/api/upload': { limit: 10, windowMs: 300000 },
   *   '/api/**': { limit: 100, windowMs: 60000 },
   * }
   * ```
   */
  routes?: Record<string, RouteRateLimitConfig>

  /**
   * Internal: JSON-serialized routes config for runtime.
   * Do not set this directly - use `routes` instead.
   * @internal
   */
  routesJson?: string

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
   * Header style to use for rate limit headers.
   * - 'legacy': X-RateLimit-* headers (default, widely supported)
   * - 'standard': RateLimit-* headers (IETF draft standard)
   * - 'both': Include both header styles
   * @default 'both'
   */
  headerStyle?: HeaderStyle

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
    name: '@jfungus/ratelimit-nuxt',
    configKey: 'rateLimit',
    compatibility: {
      nuxt: '^3.0.0',
    },
  },
  defaults: {
    enabled: true,
    limit: 100,
    windowMs: 60_000,
    algorithm: 'sliding-window' as Algorithm,
    storage: 'memory',
    skip: ['/_nuxt/**', '/__nuxt_error'],
    include: [] as string[],
    routes: {} as Record<string, RouteRateLimitConfig>,
    // routesJson is used in runtime config (routes gets serialized to this)
    routesJson: '{}',
    statusCode: 429,
    message: 'Too Many Requests',
    headers: true,
    headerStyle: 'both' as HeaderStyle,
    keyGenerator: 'ip' as const,
    dryRun: false,
  },
  setup(options, nuxt) {
    if (!options.enabled) {
      return
    }

    const resolver = createResolver(import.meta.url)

    // Build the complete config object with fields that survive Nuxt's schema filtering
    const rateLimitConfig = {
      limit: options.limit!,
      windowMs: options.windowMs!,
      algorithm: options.algorithm!,
      storage: options.storage!,
      skip: options.skip!,
      include: options.include || [],
      routesJson: JSON.stringify(options.routes || {}),
      statusCode: options.statusCode!,
      message: options.message!,
      headers: options.headers!,
      headerStyle: options.headerStyle || 'both',
      keyGenerator: options.keyGenerator!,
      dryRun: options.dryRun!,
    }

    // Set the runtime config with all options (some fields may be stripped by Nuxt)
    nuxt.options.runtimeConfig.rateLimit = defu(
      nuxt.options.runtimeConfig.rateLimit as object,
      rateLimitConfig,
    )

    // Use Nitro's virtual modules to inject the config at build time
    // This bypasses Nuxt's runtime config schema filtering and ensures
    // routesJson and headerStyle survive to production
    // @ts-expect-error - nitro:config hook exists but may not be in types
    nuxt.hook('nitro:config', (nitroConfig: { virtual?: Record<string, string> }) => {
      // Create a virtual module with the full config
      nitroConfig.virtual = nitroConfig.virtual || {}
      nitroConfig.virtual['#ratelimit-config'] = `export default ${JSON.stringify(rateLimitConfig)}`
    })

    // Add the server middleware
    addServerHandler({
      handler: resolver.resolve('../runtime-js/server/middleware/ratelimit.js'),
      middleware: true,
    })
  },
})
