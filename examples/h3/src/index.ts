import { MemoryStore, rateLimiter } from '@jfungus/ratelimit-h3'
import { createApp, createRouter, defineEventHandler, getQuery, toNodeListener } from 'h3'
import { listen } from 'listhen'

const app = createApp()
const router = createRouter()

// ---------------------------------------------------------------------------
// Global rate limiter: 10 req/min
// Skips /api/health so the health check is never rate limited.
// ---------------------------------------------------------------------------
app.use(
  rateLimiter({
    limit: 10,
    windowMs: 60_000,
    store: new MemoryStore(),
    skip: (event) =>
      ['/api/health', '/api/auth/login', '/api/upload', '/api/custom-key'].includes(event.path),
  }),
)

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get(
  '/',
  defineEventHandler((event) => ({
    message: 'H3 rate limit example',
    rateLimit: event.context.rateLimit,
  })),
)

router.get(
  '/api/public',
  defineEventHandler((event) => ({
    message: 'Public endpoint',
    rateLimit: event.context.rateLimit,
  })),
)

router.get(
  '/api/health',
  defineEventHandler(() => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })),
)

// Strict auth limiter: 5 req/min (own store for independent counter)
router.post(
  '/api/auth/login',
  defineEventHandler({
    onRequest: [
      rateLimiter({
        limit: 5,
        windowMs: 60_000,
        store: new MemoryStore(),
      }),
    ],
    handler: (event) => ({
      message: 'Login endpoint',
      rateLimit: event.context.rateLimit,
    }),
  }),
)

// Upload limiter: 3 req/5min (own store for independent counter)
router.post(
  '/api/upload',
  defineEventHandler({
    onRequest: [
      rateLimiter({
        limit: 3,
        windowMs: 5 * 60_000,
        store: new MemoryStore(),
      }),
    ],
    handler: (event) => ({
      message: 'Upload endpoint',
      rateLimit: event.context.rateLimit,
    }),
  }),
)

// Custom key: rate limit by ?user= query param
router.get(
  '/api/custom-key',
  defineEventHandler({
    onRequest: [
      rateLimiter({
        limit: 10,
        windowMs: 60_000,
        store: new MemoryStore(),
        keyGenerator: (event) => {
          const query = getQuery(event)
          return (query.user as string) || 'anonymous'
        },
      }),
    ],
    handler: (event) => {
      const query = getQuery(event)
      return {
        message: 'Custom key endpoint',
        user: query.user || 'anonymous',
        rateLimit: event.context.rateLimit,
      }
    },
  }),
)

app.use(router)

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const port = Number(process.env.PORT) || 3000

listen(toNodeListener(app), { port, hostname: '0.0.0.0' }).then(({ url }) => {
  console.log(`H3 example listening on ${url}`)
})
