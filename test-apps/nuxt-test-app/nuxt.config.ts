export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: false },

  modules: ['@jfungus/ratelimit-nuxt'],

  rateLimit: {
    enabled: true,
    limit: 5,
    windowMs: 5 * 1000, // 5 seconds for faster testing
    algorithm: 'sliding-window',
    skip: ['/_nuxt/**', '/__nuxt_error'],
    headerStyle: 'both', // Include both X-RateLimit-* and RateLimit-* headers

    // Per-route configuration
    routes: {
      // Auth routes have stricter limits (3 requests per 5 seconds)
      '/api/auth/**': { limit: 3, windowMs: 5 * 1000 },
      // Upload route has custom limit (2 requests per 10 seconds)
      '/api/upload': { limit: 2, windowMs: 10 * 1000 },
    },
  },
})
