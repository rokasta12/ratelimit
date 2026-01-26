import { createApp, eventHandler, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStore, rateLimiter, shutdownDefaultStore } from './index'

// Simple test helper to make requests
async function makeRequest(
  app: ReturnType<typeof createApp>,
  path = '/',
  headers: Record<string, string> = {},
): Promise<Response> {
  const listener = toNodeListener(app)

  // Create a mock request/response for testing
  return new Promise((resolve) => {
    const req = {
      method: 'GET',
      url: path,
      headers: { ...headers, host: 'localhost' },
      on: (_: string, cb: () => void) => cb(),
    } as any

    let statusCode = 200
    const responseHeaders: Record<string, string> = {}
    let body = ''

    const res = {
      statusCode: 200,
      setHeader: (name: string, value: string) => {
        responseHeaders[name.toLowerCase()] = value
      },
      getHeader: (name: string) => responseHeaders[name.toLowerCase()],
      end: (data?: string) => {
        body = data || ''
        resolve({
          status: statusCode,
          headers: {
            get: (name: string) => responseHeaders[name.toLowerCase()] || null,
          },
          text: async () => body,
        } as any)
      },
      writeHead: (code: number) => {
        statusCode = code
      },
    } as any

    // Intercept statusCode setter
    Object.defineProperty(res, 'statusCode', {
      get: () => statusCode,
      set: (code: number) => {
        statusCode = code
      },
    })

    listener(req, res)
  })
}

// Simple key generator for tests (since mock requests don't have real sockets)
const testKeyGenerator = () => 'test-client'

describe('@jf/ratelimit-h3', () => {
  afterEach(() => {
    shutdownDefaultStore()
  })

  describe('rateLimiter', () => {
    it('allows requests under limit', async () => {
      const app = createApp()
      app.use(
        rateLimiter({
          limit: 10,
          windowMs: 60_000,
          keyGenerator: testKeyGenerator,
        }),
      )
      app.use(eventHandler(() => 'OK'))

      const res = await makeRequest(app)
      expect(res.status).toBe(200)
      expect(res.headers.get('x-ratelimit-limit')).toBe('10')
      expect(res.headers.get('x-ratelimit-remaining')).toBe('9')
    })

    it('blocks requests over limit', async () => {
      const app = createApp()
      app.use(
        rateLimiter({
          limit: 2,
          windowMs: 60_000,
          keyGenerator: testKeyGenerator,
        }),
      )
      app.use(eventHandler(() => 'OK'))

      await makeRequest(app)
      await makeRequest(app)
      const res = await makeRequest(app)

      expect(res.status).toBe(429)
      expect(await res.text()).toBe('Rate limit exceeded')
    })

    it('supports custom key generator', async () => {
      const app = createApp()
      app.use(
        rateLimiter({
          limit: 2,
          windowMs: 60_000,
          keyGenerator: (event) => event.headers.get('x-user-id') || 'anonymous',
        }),
      )
      app.use(eventHandler(() => 'OK'))

      await makeRequest(app, '/', { 'x-user-id': 'user1' })
      await makeRequest(app, '/', { 'x-user-id': 'user1' })
      const res1 = await makeRequest(app, '/', { 'x-user-id': 'user1' })
      const res2 = await makeRequest(app, '/', { 'x-user-id': 'user2' })

      expect(res1.status).toBe(429)
      expect(res2.status).toBe(200)
    })

    it('supports skip option', async () => {
      const app = createApp()
      app.use(
        rateLimiter({
          limit: 1,
          windowMs: 60_000,
          keyGenerator: testKeyGenerator,
          skip: (event) => event.path === '/health',
        }),
      )
      app.use(eventHandler(() => 'OK'))

      await makeRequest(app, '/api')
      const healthRes = await makeRequest(app, '/health')
      const apiRes = await makeRequest(app, '/api')

      expect(healthRes.status).toBe(200)
      expect(apiRes.status).toBe(429)
    })

    it('supports custom store', async () => {
      const store = new MemoryStore()
      store.init(60_000)

      const app = createApp()
      app.use(
        rateLimiter({
          limit: 10,
          windowMs: 60_000,
          store,
          keyGenerator: testKeyGenerator,
        }),
      )
      app.use(eventHandler(() => 'OK'))

      const res = await makeRequest(app)
      expect(res.status).toBe(200)

      store.shutdown()
    })

    it('supports dry-run mode', async () => {
      const onRateLimited = vi.fn()

      const app = createApp()
      app.use(
        rateLimiter({
          limit: 1,
          windowMs: 60_000,
          dryRun: true,
          onRateLimited,
          keyGenerator: testKeyGenerator,
        }),
      )
      app.use(eventHandler(() => 'OK'))

      await makeRequest(app)
      const res = await makeRequest(app)

      expect(res.status).toBe(200)
      expect(onRateLimited).toHaveBeenCalled()
    })

    it('throws on invalid limit', () => {
      expect(() => rateLimiter({ limit: 0 })).toThrow('limit must be a positive number')
    })

    it('throws on invalid windowMs', () => {
      expect(() => rateLimiter({ windowMs: 0 })).toThrow('windowMs must be a positive number')
    })
  })
})
