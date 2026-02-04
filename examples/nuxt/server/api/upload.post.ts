export default defineEventHandler((event) => ({
  message: 'Upload endpoint',
  rateLimit: event.context.rateLimit,
}))
