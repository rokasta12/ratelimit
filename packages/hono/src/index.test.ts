import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MemoryStore,
  cloudflareRateLimiter,
  getClientIP,
  rateLimiter,
  shutdownDefaultStore,
} from './index'

describe('@jfungus/ratelimit-hono', () => {
  afterEach(() => {
    shutdownDefaultStore()
  })

  describe('rateLimiter middleware', () => {
    describe('basic functionality', () => {
      it('allows requests under limit', async () => {
        const app = new Hono()
        app.use(rateLimiter({ limit: 10, windowMs: 60_000 }))
        app.get('/', (c) => c.text('OK'))

        const res = await app.request('/')
        expect(res.status).toBe(200)
        expect(res.headers.get('X-RateLimit-Limit')).toBe('10')
        expect(res.headers.get('X-RateLimit-Remaining')).toBe('9')
      })

      it('blocks requests over limit', async () => {
        const app = new Hono()
        app.use(rateLimiter({ limit: 2, windowMs: 60_000 }))
        app.get('/', (c) => c.text('OK'))

        await app.request('/')
        await app.request('/')
        const res = await app.request('/')

        expect(res.status).toBe(429)
        expect(await res.text()).toBe('Rate limit exceeded')
      })

      it('sets context variables', async () => {
        const app = new Hono()
        let rateLimitInfo: { limit: number; remaining: number } | undefined
        let storeAccess: { resetKey: (key: string) => void | Promise<void> } | undefined

        app.use(rateLimiter({ limit: 10, windowMs: 60_000 }))
        app.get('/', (c) => {
          rateLimitInfo = c.get('rateLimit')
          storeAccess = c.get('rateLimitStore')
          return c.text('OK')
        })

        await app.request('/')

        expect(rateLimitInfo).toBeDefined()
        expect(rateLimitInfo?.limit).toBe(10)
        expect(rateLimitInfo?.remaining).toBe(9)
        expect(storeAccess).toBeDefined()
        expect(typeof storeAccess?.resetKey).toBe('function')
      })
    })

    describe('custom key generator', () => {
      it('uses custom key generator', async () => {
        const app = new Hono()
        app.use(
          rateLimiter({
            limit: 2,
            windowMs: 60_000,
            keyGenerator: (c) => c.req.header('X-User-ID') ?? 'anonymous',
          }),
        )
        app.get('/', (c) => c.text('OK'))

        // User 1 makes 3 requests
        await app.request('/', { headers: { 'X-User-ID': 'user1' } })
        await app.request('/', { headers: { 'X-User-ID': 'user1' } })
        const res1 = await app.request('/', {
          headers: { 'X-User-ID': 'user1' },
        })

        // User 2 makes 1 request
        const res2 = await app.request('/', {
          headers: { 'X-User-ID': 'user2' },
        })

        expect(res1.status).toBe(429)
        expect(res2.status).toBe(200)
      })
    })

    describe('skip option', () => {
      it('skips rate limiting for certain requests', async () => {
        const app = new Hono()
        app.use(
          rateLimiter({
            limit: 1,
            windowMs: 60_000,
            skip: (c) => c.req.path === '/health',
          }),
        )
        app.get('/health', (c) => c.text('OK'))
        app.get('/api', (c) => c.text('API'))

        // First API request - uses the limit
        await app.request('/api')
        // Health endpoint - skipped
        const healthRes = await app.request('/health')
        // Second API request - should be rate limited
        const apiRes = await app.request('/api')

        expect(healthRes.status).toBe(200)
        expect(apiRes.status).toBe(429)
      })
    })

    describe('custom handler', () => {
      it('uses custom rate limit handler', async () => {
        const app = new Hono()
        app.use(
          rateLimiter({
            limit: 1,
            windowMs: 60_000,
            handler: (c, info) =>
              c.json({ error: 'Too many requests', retryAfter: info.reset }, 429),
          }),
        )
        app.get('/', (c) => c.text('OK'))

        await app.request('/')
        const res = await app.request('/')

        expect(res.status).toBe(429)
        const body = (await res.json()) as {
          error: string
          retryAfter: number
        }
        expect(body.error).toBe('Too many requests')
        expect(body.retryAfter).toBeDefined()
      })
    })

    describe('dry-run mode', () => {
      it('tracks but does not block in dry-run mode', async () => {
        const app = new Hono()
        const onRateLimited = vi.fn()

        app.use(
          rateLimiter({
            limit: 1,
            windowMs: 60_000,
            dryRun: true,
            onRateLimited,
          }),
        )
        app.get('/', (c) => c.text('OK'))

        await app.request('/')
        const res = await app.request('/')

        expect(res.status).toBe(200)
        expect(onRateLimited).toHaveBeenCalled()
      })
    })

    describe('header formats', () => {
      it('sets legacy headers by default', async () => {
        const app = new Hono()
        app.use(rateLimiter({ limit: 10, windowMs: 60_000 }))
        app.get('/', (c) => c.text('OK'))

        const res = await app.request('/')

        expect(res.headers.get('X-RateLimit-Limit')).toBe('10')
        expect(res.headers.get('X-RateLimit-Remaining')).toBe('9')
        expect(res.headers.get('X-RateLimit-Reset')).toBeDefined()
      })

      it('sets draft-6 headers', async () => {
        const app = new Hono()
        app.use(rateLimiter({ limit: 10, windowMs: 60_000, headers: 'draft-6' }))
        app.get('/', (c) => c.text('OK'))

        const res = await app.request('/')

        expect(res.headers.get('RateLimit-Policy')).toBe('10;w=60')
        expect(res.headers.get('RateLimit-Limit')).toBe('10')
        expect(res.headers.get('RateLimit-Remaining')).toBe('9')
        expect(res.headers.get('RateLimit-Reset')).toBeDefined()
      })

      it('sets draft-7 headers', async () => {
        const app = new Hono()
        app.use(rateLimiter({ limit: 10, windowMs: 60_000, headers: 'draft-7' }))
        app.get('/', (c) => c.text('OK'))

        const res = await app.request('/')

        expect(res.headers.get('RateLimit-Policy')).toBe('10;w=60')
        expect(res.headers.get('RateLimit')).toMatch(/limit=10, remaining=9, reset=\d+/)
      })

      it('sets standard (IETF) headers', async () => {
        const app = new Hono()
        app.use(
          rateLimiter({
            limit: 10,
            windowMs: 60_000,
            headers: 'standard',
            identifier: 'api',
          }),
        )
        app.get('/', (c) => c.text('OK'))

        const res = await app.request('/')

        expect(res.headers.get('RateLimit-Policy')).toBe('"api";q=10;w=60')
        expect(res.headers.get('RateLimit')).toMatch(/"api";r=9;t=\d+/)
      })

      it('disables headers when false', async () => {
        const app = new Hono()
        app.use(rateLimiter({ limit: 10, windowMs: 60_000, headers: false }))
        app.get('/', (c) => c.text('OK'))

        const res = await app.request('/')

        expect(res.headers.get('X-RateLimit-Limit')).toBeNull()
        expect(res.headers.get('RateLimit')).toBeNull()
      })
    })

    describe('dynamic limit', () => {
      it('supports dynamic limit function', async () => {
        const app = new Hono()
        app.use(
          rateLimiter({
            limit: (c) => (c.req.header('X-Premium') ? 100 : 2),
            windowMs: 60_000,
          }),
        )
        app.get('/', (c) => c.text('OK'))

        // Free user
        await app.request('/')
        await app.request('/')
        const freeRes = await app.request('/')

        // Premium user
        const premiumRes = await app.request('/', {
          headers: { 'X-Premium': 'true' },
        })

        expect(freeRes.status).toBe(429)
        expect(premiumRes.status).toBe(200)
        expect(premiumRes.headers.get('X-RateLimit-Limit')).toBe('100')
      })
    })

    describe('algorithms', () => {
      it('uses sliding window by default', async () => {
        const app = new Hono()
        app.use(rateLimiter({ limit: 10, windowMs: 60_000 }))
        app.get('/', (c) => c.text('OK'))

        const res = await app.request('/')
        expect(res.status).toBe(200)
      })

      it('supports fixed window algorithm', async () => {
        const app = new Hono()
        app.use(
          rateLimiter({
            limit: 10,
            windowMs: 60_000,
            algorithm: 'fixed-window',
          }),
        )
        app.get('/', (c) => c.text('OK'))

        const res = await app.request('/')
        expect(res.status).toBe(200)
      })
    })

    describe('custom store', () => {
      it('uses custom store', async () => {
        const store = new MemoryStore()
        store.init(60_000)

        const app = new Hono()
        app.use(rateLimiter({ limit: 10, windowMs: 60_000, store }))
        app.get('/', (c) => c.text('OK'))

        const res = await app.request('/')
        expect(res.status).toBe(200)

        store.shutdown()
      })
    })

    describe('error handling', () => {
      it('throws on invalid limit', () => {
        expect(() => rateLimiter({ limit: 0, windowMs: 60_000 })).toThrow(
          'limit must be a positive number',
        )
      })

      it('throws on invalid windowMs', () => {
        expect(() => rateLimiter({ limit: 10, windowMs: 0 })).toThrow(
          'windowMs must be a positive number',
        )
      })
    })

    describe('skipSuccessfulRequests', () => {
      it('decrements counter on successful requests', async () => {
        const app = new Hono()
        app.use(
          rateLimiter({
            limit: 2,
            windowMs: 60_000,
            skipSuccessfulRequests: true,
          }),
        )
        app.get('/success', (c) => c.text('OK'))
        app.get('/error', (c) => c.text('Error', 500))

        // Successful requests don't count
        await app.request('/success')
        await app.request('/success')
        await app.request('/success')
        const successRes = await app.request('/success')

        // Error requests count
        await app.request('/error')
        await app.request('/error')
        const errorRes = await app.request('/error')

        expect(successRes.status).toBe(200)
        expect(errorRes.status).toBe(429)
      })
    })

    describe('onRateLimited callback', () => {
      it('calls callback when rate limited', async () => {
        const onRateLimited = vi.fn()
        const app = new Hono()
        app.use(
          rateLimiter({
            limit: 1,
            windowMs: 60_000,
            onRateLimited,
          }),
        )
        app.get('/', (c) => c.text('OK'))

        await app.request('/')
        await app.request('/')

        expect(onRateLimited).toHaveBeenCalledTimes(1)
        expect(onRateLimited.mock.calls[0][1]).toHaveProperty('limit', 1)
      })
    })
  })

  describe('getClientIP', () => {
    it('extracts CF-Connecting-IP', async () => {
      const app = new Hono()
      let ip: string | undefined

      app.use((c, next) => {
        ip = getClientIP(c)
        return next()
      })
      app.get('/', (c) => c.text('OK'))

      await app.request('/', { headers: { 'CF-Connecting-IP': '1.2.3.4' } })
      expect(ip).toBe('1.2.3.4')
    })

    it('extracts X-Real-IP', async () => {
      const app = new Hono()
      let ip: string | undefined

      app.use((c, next) => {
        ip = getClientIP(c)
        return next()
      })
      app.get('/', (c) => c.text('OK'))

      await app.request('/', { headers: { 'X-Real-IP': '5.6.7.8' } })
      expect(ip).toBe('5.6.7.8')
    })

    it('extracts X-Forwarded-For (first IP)', async () => {
      const app = new Hono()
      let ip: string | undefined

      app.use((c, next) => {
        ip = getClientIP(c)
        return next()
      })
      app.get('/', (c) => c.text('OK'))

      await app.request('/', {
        headers: { 'X-Forwarded-For': '1.1.1.1, 2.2.2.2, 3.3.3.3' },
      })
      expect(ip).toBe('1.1.1.1')
    })

    it('returns unknown when no IP headers', async () => {
      const app = new Hono()
      let ip: string | undefined

      app.use((c, next) => {
        ip = getClientIP(c)
        return next()
      })
      app.get('/', (c) => c.text('OK'))

      await app.request('/')
      expect(ip).toBe('unknown')
    })
  })

  describe('configure()', () => {
    it('changes limit at runtime', async () => {
      const app = new Hono()
      const limiter = rateLimiter({ limit: 10, windowMs: 60_000 })
      app.use(limiter)
      app.get('/', (c) => c.text('OK'))

      const res1 = await app.request('/')
      expect(res1.headers.get('X-RateLimit-Limit')).toBe('10')

      limiter.configure({ limit: 50 })

      const res2 = await app.request('/')
      expect(res2.headers.get('X-RateLimit-Limit')).toBe('50')
    })

    it('changes headers format at runtime', async () => {
      const app = new Hono()
      const limiter = rateLimiter({ limit: 10, windowMs: 60_000, headers: 'legacy' })
      app.use(limiter)
      app.get('/', (c) => c.text('OK'))

      const res1 = await app.request('/')
      expect(res1.headers.get('X-RateLimit-Limit')).toBe('10')
      expect(res1.headers.get('RateLimit-Policy')).toBeNull()

      limiter.configure({ headers: 'draft-6' })

      const res2 = await app.request('/')
      expect(res2.headers.get('X-RateLimit-Limit')).toBeNull()
      expect(res2.headers.get('RateLimit-Policy')).toBe('10;w=60')
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
        limiter.configure({ store: new MemoryStore() } as Parameters<typeof limiter.configure>[0]),
      ).toThrow("Cannot change 'store' at runtime")
    })

    it('throws on invalid limit value', () => {
      const limiter = rateLimiter({ limit: 10, windowMs: 60_000 })
      expect(() => limiter.configure({ limit: 0 })).toThrow('limit must be a positive number')
      expect(() => limiter.configure({ limit: -5 })).toThrow('limit must be a positive number')
    })
  })

  describe('cloudflareRateLimiter', () => {
    it('allows requests when limit succeeds', async () => {
      const mockBinding = {
        limit: vi.fn().mockResolvedValue({ success: true }),
      }

      const app = new Hono()
      app.use(
        cloudflareRateLimiter({
          binding: mockBinding,
          keyGenerator: () => 'test-key',
        }),
      )
      app.get('/', (c) => c.text('OK'))

      const res = await app.request('/')
      expect(res.status).toBe(200)
      expect(mockBinding.limit).toHaveBeenCalledWith({ key: 'test-key' })
    })

    it('blocks requests when limit fails', async () => {
      const mockBinding = {
        limit: vi.fn().mockResolvedValue({ success: false }),
      }

      const app = new Hono()
      app.use(
        cloudflareRateLimiter({
          binding: mockBinding,
          keyGenerator: () => 'test-key',
        }),
      )
      app.get('/', (c) => c.text('OK'))

      const res = await app.request('/')
      expect(res.status).toBe(429)
    })

    it('supports skip option', async () => {
      const mockBinding = {
        limit: vi.fn().mockResolvedValue({ success: true }),
      }

      const app = new Hono()
      app.use(
        cloudflareRateLimiter({
          binding: mockBinding,
          keyGenerator: () => 'test-key',
          skip: (c) => c.req.path === '/health',
        }),
      )
      app.get('/health', (c) => c.text('OK'))

      await app.request('/health')
      expect(mockBinding.limit).not.toHaveBeenCalled()
    })

    it('supports custom handler', async () => {
      const mockBinding = {
        limit: vi.fn().mockResolvedValue({ success: false }),
      }

      const app = new Hono()
      app.use(
        cloudflareRateLimiter({
          binding: mockBinding,
          keyGenerator: () => 'test-key',
          handler: () => new Response('Custom error', { status: 429 }),
        }),
      )
      app.get('/', (c) => c.text('OK'))

      const res = await app.request('/')
      expect(await res.text()).toBe('Custom error')
    })
  })
})
