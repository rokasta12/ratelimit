export default defineEventHandler((event) => ({
  message: 'Public endpoint',
  rateLimit: event.context.rateLimit,
}))
