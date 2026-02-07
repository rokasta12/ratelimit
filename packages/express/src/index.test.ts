import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStore, rateLimiter, shutdownDefaultStore } from './index'

describe('@jfungus/ratelimit-express', () => {
  afterEach(() => {
    shutdownDefaultStore()
  })

  describe('rateLimiter', () => {
    it('allows requests under limit', async () => {
      const app = express()
      app.use(rateLimiter({ limit: 10, windowMs: 60_000 }))
      app.get('/', (_req, res) => res.send('OK'))

      const res = await request(app).get('/')

      expect(res.status).toBe(200)
      expect(res.headers['x-ratelimit-limit']).toBe('10')
      expect(res.headers['x-ratelimit-remaining']).toBe('9')
    })

    it('blocks requests over limit', async () => {
      const app = express()
      app.use(rateLimiter({ limit: 2, windowMs: 60_000 }))
      app.get('/', (_req, res) => res.send('OK'))

      await request(app).get('/')
      await request(app).get('/')
      const res = await request(app).get('/')

      expect(res.status).toBe(429)
      expect(res.text).toBe('Rate limit exceeded')
    })

    it('supports custom key generator', async () => {
      const app = express()
      app.use(
        rateLimiter({
          limit: 2,
          windowMs: 60_000,
          keyGenerator: (req) => req.get('x-user-id') || 'anonymous',
        }),
      )
      app.get('/', (_req, res) => res.send('OK'))

      await request(app).get('/').set('x-user-id', 'user1')
      await request(app).get('/').set('x-user-id', 'user1')
      const res1 = await request(app).get('/').set('x-user-id', 'user1')
      const res2 = await request(app).get('/').set('x-user-id', 'user2')

      expect(res1.status).toBe(429)
      expect(res2.status).toBe(200)
    })

    it('supports skip option', async () => {
      const app = express()
      app.use(
        rateLimiter({
          limit: 1,
          windowMs: 60_000,
          skip: (req) => req.path === '/health',
        }),
      )
      app.get('/health', (_req, res) => res.send('OK'))
      app.get('/api', (_req, res) => res.send('OK'))

      await request(app).get('/api')
      const healthRes = await request(app).get('/health')
      const apiRes = await request(app).get('/api')

      expect(healthRes.status).toBe(200)
      expect(apiRes.status).toBe(429)
    })

    it('supports custom store', async () => {
      const store = new MemoryStore()
      store.init(60_000)

      const app = express()
      app.use(rateLimiter({ limit: 10, windowMs: 60_000, store }))
      app.get('/', (_req, res) => res.send('OK'))

      const res = await request(app).get('/')
      expect(res.status).toBe(200)

      store.shutdown()
    })

    it('supports dry-run mode', async () => {
      const onRateLimited = vi.fn()

      const app = express()
      app.use(
        rateLimiter({
          limit: 1,
          windowMs: 60_000,
          dryRun: true,
          onRateLimited,
        }),
      )
      app.get('/', (_req, res) => res.send('OK'))

      await request(app).get('/')
      const res = await request(app).get('/')

      expect(res.status).toBe(200)
      expect(onRateLimited).toHaveBeenCalled()
    })

    it('supports standard headers (legacy boolean)', async () => {
      const app = express()
      app.use(
        rateLimiter({
          limit: 10,
          windowMs: 60_000,
          legacyHeaders: false,
          standardHeaders: true,
        }),
      )
      app.get('/', (_req, res) => res.send('OK'))

      const res = await request(app).get('/')

      expect(res.headers['ratelimit-limit']).toBe('10')
      expect(res.headers['ratelimit-remaining']).toBe('9')
      expect(res.headers['x-ratelimit-limit']).toBeUndefined()
    })

    describe('header formats', () => {
      it('sets legacy headers by default', async () => {
        const app = express()
        app.use(rateLimiter({ limit: 10, windowMs: 60_000 }))
        app.get('/', (_req, res) => res.send('OK'))

        const res = await request(app).get('/')

        expect(res.headers['x-ratelimit-limit']).toBe('10')
        expect(res.headers['x-ratelimit-remaining']).toBe('9')
        expect(res.headers['x-ratelimit-reset']).toBeDefined()
      })

      it('sets draft-6 headers', async () => {
        const app = express()
        app.use(rateLimiter({ limit: 10, windowMs: 60_000, headers: 'draft-6' }))
        app.get('/', (_req, res) => res.send('OK'))

        const res = await request(app).get('/')

        expect(res.headers['ratelimit-policy']).toBe('10;w=60')
        expect(res.headers['ratelimit-limit']).toBe('10')
        expect(res.headers['ratelimit-remaining']).toBe('9')
        expect(res.headers['ratelimit-reset']).toBeDefined()
        expect(res.headers['x-ratelimit-limit']).toBeUndefined()
      })

      it('sets draft-7 headers', async () => {
        const app = express()
        app.use(rateLimiter({ limit: 10, windowMs: 60_000, headers: 'draft-7' }))
        app.get('/', (_req, res) => res.send('OK'))

        const res = await request(app).get('/')

        expect(res.headers['ratelimit-policy']).toBe('10;w=60')
        expect(res.headers.ratelimit).toMatch(/limit=10, remaining=9, reset=\d+/)
        expect(res.headers['x-ratelimit-limit']).toBeUndefined()
      })

      it('sets standard (IETF) headers', async () => {
        const app = express()
        app.use(rateLimiter({ limit: 10, windowMs: 60_000, headers: 'standard' }))
        app.get('/', (_req, res) => res.send('OK'))

        const res = await request(app).get('/')

        expect(res.headers['ratelimit-policy']).toMatch(/"default";q=10;w=60/)
        expect(res.headers.ratelimit).toMatch(/"default";r=9;t=\d+/)
        expect(res.headers['x-ratelimit-limit']).toBeUndefined()
      })

      it('disables headers when false', async () => {
        const app = express()
        app.use(rateLimiter({ limit: 10, windowMs: 60_000, headers: false }))
        app.get('/', (_req, res) => res.send('OK'))

        const res = await request(app).get('/')

        expect(res.headers['x-ratelimit-limit']).toBeUndefined()
        expect(res.headers['ratelimit-limit']).toBeUndefined()
        expect(res.headers['ratelimit-policy']).toBeUndefined()
        expect(res.headers.ratelimit).toBeUndefined()
      })
    })

    it('sets request.rateLimit', async () => {
      const app = express()
      app.use(rateLimiter({ limit: 10, windowMs: 60_000 }))
      app.get('/', (req, res) => {
        res.json(req.rateLimit)
      })

      const res = await request(app).get('/')

      expect(res.body.limit).toBe(10)
      expect(res.body.remaining).toBe(9)
    })

    describe('configure()', () => {
      it('changes limit at runtime', async () => {
        const app = express()
        const limiter = rateLimiter({ limit: 10, windowMs: 60_000 })
        app.use(limiter)
        app.get('/', (_req, res) => res.send('OK'))

        const res1 = await request(app).get('/')
        expect(res1.headers['x-ratelimit-limit']).toBe('10')

        limiter.configure({ limit: 50 })

        const res2 = await request(app).get('/')
        expect(res2.headers['x-ratelimit-limit']).toBe('50')
      })

      it('throws on windowMs change', () => {
        const limiter = rateLimiter({ limit: 10, windowMs: 60_000 })
        expect(() =>
          limiter.configure({ windowMs: 30_000 } as Parameters<typeof limiter.configure>[0]),
        ).toThrow("Cannot change 'windowMs' at runtime")
      })

      it('throws on algorithm change', () => {
        const limiter = rateLimiter({ limit: 10, windowMs: 60_000 })
        expect(() =>
          limiter.configure({
            algorithm: 'fixed-window',
          } as Parameters<typeof limiter.configure>[0]),
        ).toThrow("Cannot change 'algorithm' at runtime")
      })

      it('throws on store change', () => {
        const limiter = rateLimiter({ limit: 10, windowMs: 60_000 })
        expect(() =>
          limiter.configure({ store: new MemoryStore() } as Parameters<
            typeof limiter.configure
          >[0]),
        ).toThrow("Cannot change 'store' at runtime")
      })

      it('throws on invalid limit value', () => {
        const limiter = rateLimiter({ limit: 10, windowMs: 60_000 })
        expect(() => limiter.configure({ limit: 0 })).toThrow('limit must be a positive number')
        expect(() => limiter.configure({ limit: -5 })).toThrow('limit must be a positive number')
      })
    })

    it('throws on invalid limit', () => {
      expect(() => rateLimiter({ limit: 0 })).toThrow('limit must be a positive number')
    })

    it('throws on invalid windowMs', () => {
      expect(() => rateLimiter({ windowMs: 0 })).toThrow('windowMs must be a positive number')
    })

    it('supports dynamic limit function', async () => {
      const app = express()
      app.use(
        rateLimiter({
          limit: (req) => (req.get('x-premium') === 'true' ? 100 : 2),
          windowMs: 60_000,
        }),
      )
      app.get('/', (_req, res) => res.send('OK'))

      // Regular user: limit 2
      await request(app).get('/')
      await request(app).get('/')
      const regularRes = await request(app).get('/')
      expect(regularRes.status).toBe(429)

      // Premium user: limit 100
      const premiumRes = await request(app).get('/').set('x-premium', 'true')
      expect(premiumRes.status).toBe(200)
      expect(premiumRes.headers['x-ratelimit-limit']).toBe('100')
    })

    it('supports custom handler', async () => {
      const app = express()
      app.use(
        rateLimiter({
          limit: 1,
          windowMs: 60_000,
          handler: (_req, res, info) => {
            res.status(429).json({ error: 'Too many requests', retryAfter: info.reset })
          },
        }),
      )
      app.get('/', (_req, res) => res.send('OK'))

      await request(app).get('/')
      const res = await request(app).get('/')

      expect(res.status).toBe(429)
      expect(res.body.error).toBe('Too many requests')
    })
  })
})
