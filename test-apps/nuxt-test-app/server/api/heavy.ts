// A heavier endpoint to test rate limiting
export default defineEventHandler(async (event) => {
  // Simulate some work
  await new Promise((resolve) => setTimeout(resolve, 50))

  const rateLimitInfo = event.context.rateLimit

  return {
    message: 'Heavy computation done!',
    timestamp: Date.now(),
    rateLimit: rateLimitInfo || null,
  }
})
