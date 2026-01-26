import { rateLimiter } from '@jfungus/ratelimit-express'
import express from 'express'

const app = express()

// Apply rate limiting: 10 requests per minute
app.use(
  rateLimiter({
    limit: 10,
    windowMs: 60_000, // 1 minute
  }),
)

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Hello! This endpoint is rate limited.',
    rateLimit: req.rateLimit,
  })
})

// Start server
const port = 3000
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
  console.log('Try hitting the endpoint multiple times to see rate limiting in action!')
})
