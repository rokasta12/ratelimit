/**
 * Rate limiting server middleware for Nuxt
 * @type {import('h3').EventHandler}
 */

import { MemoryStore, checkRateLimit } from '@jfungus/ratelimit'
import { createUnstorageStore } from '@jfungus/ratelimit-unstorage'
import { createError, defineEventHandler, getHeader, getRequestIP, setHeader } from 'h3'
import { useRuntimeConfig, useStorage } from '#imports'

// Import config from virtual module (injected by the Nuxt module at build time)
// This bypasses Nuxt's runtime config schema filtering
import buildConfig from '#ratelimit-config'

/** @type {Map<string, import('@jfungus/ratelimit').RateLimitStore>} */
const stores = new Map()

let unknownIPWarned = false

/**
 * Get or create a store for the given storage configuration
 * @param {Object} cfg - Rate limit config
 * @param {number} windowMs - Window duration for this specific route
 * @returns {import('@jfungus/ratelimit').RateLimitStore}
 */
function getStore(cfg, windowMs) {
  const storageKey = cfg.storage || 'memory'
  const storeKey = `${storageKey}:${windowMs}`

  if (stores.has(storeKey)) {
    return stores.get(storeKey)
  }

  if (storageKey === 'memory') {
    const store = new MemoryStore()
    store.init(windowMs)
    stores.set(storeKey, store)
    return store
  }

  // Use the canonical unstorage adapter instead of inline duplicate
  const storage = useStorage(storageKey)
  const store = createUnstorageStore({ storage })
  store.init(windowMs)
  stores.set(storeKey, store)
  return store
}

/**
 * Generate a key for rate limiting based on the request
 * @param {import('h3').H3Event} event
 * @param {'ip' | 'ip-ua' | 'custom'} keyGenerator
 * @param {string} [routePrefix] - Optional route prefix for per-route rate limiting
 * @returns {string}
 */
function generateKey(event, keyGenerator, routePrefix) {
  let ip =
    getHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() || getRequestIP(event)

  if (!ip) {
    if (!unknownIPWarned) {
      unknownIPWarned = true
      console.warn(
        '[@jfungus/ratelimit] Could not determine client IP address. All unidentified clients share a single rate limit bucket. Ensure your reverse proxy sets X-Forwarded-For or X-Real-IP headers.',
      )
    }
    ip = 'unknown'
  }

  let key = ip

  if (keyGenerator === 'ip-ua') {
    const ua = getHeader(event, 'user-agent') || 'unknown'
    key = `${ip}:${ua}`
  }

  // Add route prefix for per-route rate limiting
  if (routePrefix) {
    key = `${routePrefix}:${key}`
  }

  return key
}

/**
 * Check if a path matches a pattern
 * @param {string} path
 * @param {string} pattern
 * @returns {boolean}
 */
function matchPattern(path, pattern) {
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
}

/**
 * Check if a path matches any of the patterns
 * @param {string} path
 * @param {string[]} patterns
 * @returns {boolean}
 */
function matchesPattern(path, patterns) {
  return patterns.some((pattern) => matchPattern(path, pattern))
}

/**
 * Find matching route configuration for a path
 * @param {string} path
 * @param {Record<string, {limit: number, windowMs: number, algorithm?: string}>} routes
 * @returns {{pattern: string, config: {limit: number, windowMs: number, algorithm?: string}} | null}
 */
function findMatchingRoute(path, routes) {
  if (!routes) return null

  for (const [pattern, routeConfig] of Object.entries(routes)) {
    if (matchPattern(path, pattern)) {
      return { pattern, config: routeConfig }
    }
  }

  return null
}

/**
 * Set rate limit headers on the response
 * @param {import('h3').H3Event} event
 * @param {Object} info - Rate limit info
 * @param {number} info.limit
 * @param {number} info.remaining
 * @param {number} info.reset
 * @param {'legacy' | 'standard' | 'both'} headerStyle
 */
function setRateLimitHeaders(event, info, headerStyle) {
  const resetSeconds = Math.ceil(info.reset / 1000)

  // Legacy headers (X-RateLimit-*)
  if (headerStyle === 'legacy' || headerStyle === 'both') {
    setHeader(event, 'X-RateLimit-Limit', String(info.limit))
    setHeader(event, 'X-RateLimit-Remaining', String(info.remaining))
    setHeader(event, 'X-RateLimit-Reset', String(resetSeconds))
  }

  // Standard IETF headers (RateLimit-*)
  if (headerStyle === 'standard' || headerStyle === 'both') {
    setHeader(event, 'RateLimit-Limit', String(info.limit))
    setHeader(event, 'RateLimit-Remaining', String(info.remaining))
    setHeader(event, 'RateLimit-Reset', String(resetSeconds))
  }
}

// Cache for parsed routes config
let parsedRoutes = null

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const runtimeRateLimit = runtimeConfig.rateLimit

  // Merge runtime config with build-time config from virtual module
  // The virtual module config contains fields that may be stripped by Nuxt's schema filtering
  // (routesJson and headerStyle are often removed during production builds)
  const config = {
    ...runtimeRateLimit,
    // Use build config for fields that survive in virtual module but may be stripped from runtime config
    routesJson: buildConfig?.routesJson || runtimeRateLimit?.routesJson || '{}',
    headerStyle: buildConfig?.headerStyle || runtimeRateLimit?.headerStyle || 'both',
  }

  if (!config) {
    return
  }

  const path = event.path

  // Check skip patterns
  if (config.skip && matchesPattern(path, config.skip)) {
    return
  }

  // Check include patterns
  if (config.include && config.include.length > 0 && !matchesPattern(path, config.include)) {
    return
  }

  // Parse routes from JSON string (cached for performance)
  if (parsedRoutes === null && config.routesJson) {
    try {
      parsedRoutes = JSON.parse(config.routesJson)
    } catch {
      parsedRoutes = {}
    }
  }

  // Get header style from config (already merged from virtual module)
  const headerStyle = config.headerStyle

  // Determine rate limit configuration (per-route or global)
  let limit = config.limit
  let windowMs = config.windowMs
  let algorithm = config.algorithm
  let routePrefix = null

  // Check for per-route configuration
  const matchedRoute = findMatchingRoute(path, parsedRoutes || {})
  if (matchedRoute) {
    limit = matchedRoute.config.limit
    windowMs = matchedRoute.config.windowMs
    algorithm = matchedRoute.config.algorithm || config.algorithm
    routePrefix = matchedRoute.pattern
  }

  const store = getStore(config, windowMs)
  const key = generateKey(event, config.keyGenerator, routePrefix)

  const { allowed, info } = await checkRateLimit({
    store,
    key,
    limit,
    windowMs,
    algorithm,
  })

  // Set rate limit headers
  if (config.headers) {
    setRateLimitHeaders(event, info, headerStyle)
  }

  // Store info in event context for later use
  event.context.rateLimit = info

  // Log in dry run mode
  if (config.dryRun && !allowed) {
    console.log(
      `[ratelimit] DRY RUN - Would block request: path=${path}, key=${key}, limit=${limit}, remaining=${info.remaining}`,
    )
  }

  if (!allowed && !config.dryRun) {
    setHeader(event, 'Retry-After', Math.ceil((info.reset - Date.now()) / 1000))

    throw createError({
      statusCode: config.statusCode,
      statusMessage: config.message,
    })
  }
})
