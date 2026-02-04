export default defineEventHandler((event) => ({
  message: 'Login endpoint',
  rateLimit: event.context.rateLimit,
}))
