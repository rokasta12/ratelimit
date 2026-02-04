import { serve } from '@hono/node-server'
import { MemoryStore, rateLimiter } from '@jfungus/ratelimit-hono'
import { Hono } from 'hono'

const app = new Hono()

// ---------------------------------------------------------------------------
// Global rate limiter: 10 req/min
// Skips /api/health so the health check is never rate limited.
// ---------------------------------------------------------------------------
app.use(
  rateLimiter({
    limit: 10,
    windowMs: 60_000,
    store: new MemoryStore(),
    headers: 'legacy',
    skip: (c) =>
      ['/api/health', '/api/auth/login', '/api/upload', '/api/custom-key'].includes(c.req.path),
  }),
)

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/', (c) => {
  return c.json({
    message: 'Hono rate limit example',
    rateLimit: c.get('rateLimit'),
  })
})

app.get('/api/public', (c) => {
  return c.json({
    message: 'Public endpoint',
    rateLimit: c.get('rateLimit'),
  })
})

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Strict auth limiter: 5 req/min (own store for independent counter)
app.post(
  '/api/auth/login',
  rateLimiter({
    limit: 5,
    windowMs: 60_000,
    store: new MemoryStore(),
    headers: 'legacy',
  }),
  (c) => {
    return c.json({
      message: 'Login endpoint',
      rateLimit: c.get('rateLimit'),
    })
  },
)

// Upload limiter: 3 req/5min (own store for independent counter)
app.post(
  '/api/upload',
  rateLimiter({
    limit: 3,
    windowMs: 5 * 60_000,
    store: new MemoryStore(),
    headers: 'legacy',
  }),
  (c) => {
    return c.json({
      message: 'Upload endpoint',
      rateLimit: c.get('rateLimit'),
    })
  },
)

// Custom key: rate limit by ?user= query param
app.get(
  '/api/custom-key',
  rateLimiter({
    limit: 10,
    windowMs: 60_000,
    store: new MemoryStore(),
    keyGenerator: (c) => c.req.query('user') || 'anonymous',
    headers: 'legacy',
  }),
  (c) => {
    return c.json({
      message: 'Custom key endpoint',
      user: c.req.query('user') || 'anonymous',
      rateLimit: c.get('rateLimit'),
    })
  },
)

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const port = Number(process.env.PORT) || 3000

serve({ fetch: app.fetch, port }, () => {
  console.log(`Hono example listening on http://localhost:${port}`)
})
