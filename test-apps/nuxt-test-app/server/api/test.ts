export default defineEventHandler((event) => {
  const rateLimitInfo = event.context.rateLimit

  return {
    message: 'Hello from rate-limited API!',
    timestamp: Date.now(),
    rateLimit: rateLimitInfo || null,
  }
})
