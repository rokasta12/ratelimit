// Auth login endpoint - should have stricter rate limits via per-route config
export default defineEventHandler((event) => {
  const rateLimitInfo = event.context.rateLimit

  return {
    message: 'Auth login endpoint',
    timestamp: Date.now(),
    rateLimit: rateLimitInfo || null,
  }
})
