export default defineNuxtConfig({
  modules: ['@jfungus/ratelimit-nuxt'],

  rateLimit: {
    // Global default: 10 req/min
    limit: 10,
    windowMs: 60_000,

    // Skip rate limiting for health check and Nuxt internals
    skip: ['/_nuxt/**', '/__nuxt_error', '/api/health'],

    // Per-route overrides
    routes: {
      '/api/auth/**': { limit: 5, windowMs: 60_000 },
      '/api/upload': { limit: 3, windowMs: 5 * 60_000 },
    },

    // Include both legacy and standard headers
    headers: true,
    headerStyle: 'both',
  },

  compatibilityDate: '2025-01-01',
})
