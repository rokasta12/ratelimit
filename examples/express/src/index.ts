import { MemoryStore, rateLimiter } from '@jfungus/ratelimit-express'
import express from 'express'

const app = express()
app.use(express.json())

// Trust proxy for X-Forwarded-For
app.set('trust proxy', 1)

// ---------------------------------------------------------------------------
// Health check — placed before global rate limiter so it's never limited
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ---------------------------------------------------------------------------
// Global rate limiter: 10 req/min
// ---------------------------------------------------------------------------
const perRoutePaths = ['/api/auth/login', '/api/upload', '/api/custom-key']

app.use(
  rateLimiter({
    limit: 10,
    windowMs: 60_000,
    store: new MemoryStore(),
    skip: (req) => perRoutePaths.includes(req.path),
    legacyHeaders: true,
    standardHeaders: true,
  }),
)

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/', (req, res) => {
  res.json({
    message: 'Express rate limit example',
    rateLimit: req.rateLimit,
  })
})

app.get('/api/public', (req, res) => {
  res.json({
    message: 'Public endpoint',
    rateLimit: req.rateLimit,
  })
})

// Strict auth limiter: 5 req/min (own store for independent counter)
app.post(
  '/api/auth/login',
  rateLimiter({
    limit: 5,
    windowMs: 60_000,
    store: new MemoryStore(),
    legacyHeaders: true,
    standardHeaders: true,
  }),
  (req, res) => {
    res.json({
      message: 'Login endpoint',
      rateLimit: req.rateLimit,
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
    legacyHeaders: true,
    standardHeaders: true,
  }),
  (req, res) => {
    res.json({
      message: 'Upload endpoint',
      rateLimit: req.rateLimit,
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
    keyGenerator: (req) => (req.query.user as string) || 'anonymous',
    legacyHeaders: true,
    standardHeaders: true,
  }),
  (req, res) => {
    res.json({
      message: 'Custom key endpoint',
      user: req.query.user || 'anonymous',
      rateLimit: req.rateLimit,
    })
  },
)

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const port = Number(process.env.PORT) || 3000

app.listen(port, () => {
  console.log(`Express example listening on http://localhost:${port}`)
})
