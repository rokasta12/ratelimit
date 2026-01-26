import { serve } from '@hono/node-server'
import { rateLimiter } from '@jfungus/ratelimit-hono'
import { Hono } from 'hono'

const app = new Hono()

// Apply rate limiting: 10 requests per minute
app.use(
  rateLimiter({
    limit: 10,
    windowMs: 60_000, // 1 minute
  }),
)

// Routes
app.get('/', (c) => {
  return c.json({
    message: 'Hello! This endpoint is rate limited.',
    rateLimit: c.get('rateLimit'),
  })
})

app.get('/unlimited', (c) => {
  return c.text('This would need skip() to be unlimited')
})

// Start server
const port = 3000
console.log(`Server running at http://localhost:${port}`)
console.log('Try hitting the endpoint multiple times to see rate limiting in action!')

serve({
  fetch: app.fetch,
  port,
})
