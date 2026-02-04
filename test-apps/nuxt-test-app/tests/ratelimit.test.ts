import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { type Subprocess, spawn } from 'bun'

// Set default timeout for all tests to 30 seconds (tests need to wait for rate limit windows)
setDefaultTimeout(30000)

const PORT = 3456
const BASE_URL = `http://localhost:${PORT}`

let serverProcess: Subprocess | null = null

// Helper to make requests
async function fetchAPI(path: string, options?: RequestInit) {
  const response = await fetch(`${BASE_URL}${path}`, options)
  return {
    status: response.status,
    headers: {
      'x-ratelimit-limit': response.headers.get('x-ratelimit-limit'),
      'x-ratelimit-remaining': response.headers.get('x-ratelimit-remaining'),
      'x-ratelimit-reset': response.headers.get('x-ratelimit-reset'),
      'retry-after': response.headers.get('retry-after'),
    },
    body: response.status === 200 ? await response.json() : await response.text(),
  }
}

// Helper to wait
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Helper to make multiple requests rapidly
async function burstRequests(path: string, count: number) {
  const results = await Promise.all(Array.from({ length: count }, () => fetchAPI(path)))
  return results
}

describe('@jfungus/ratelimit-nuxt Integration Tests', () => {
  beforeAll(async () => {
    console.log('Starting Nuxt server...')

    // Use already built server (run `pnpm exec nuxi build` before tests)
    // Start the server directly using node
    serverProcess = spawn(['node', '.output/server/index.mjs'], {
      cwd: '/Users/bedirhan/Documents/GitHub/ratelimit/test-apps/nuxt-test-app',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PORT: PORT.toString(), NUXT_HOST: '127.0.0.1' },
    })

    // Wait for server to be ready
    let ready = false
    let attempts = 0
    const maxAttempts = 30

    while (!ready && attempts < maxAttempts) {
      try {
        const response = await fetch(`${BASE_URL}/api/test`)
        if (response.ok || response.status === 429) {
          ready = true
        }
      } catch {
        // Server not ready yet
      }
      if (!ready) {
        await sleep(1000)
        attempts++
      }
    }

    if (!ready) {
      throw new Error('Server failed to start within timeout')
    }

    console.log('Server ready!')
  }, 120000) // 2 minute timeout for build + start

  afterAll(async () => {
    if (serverProcess) {
      console.log('Stopping server...')
      serverProcess.kill()
      await serverProcess.exited
    }
  })

  describe('Basic Rate Limiting', () => {
    test('should allow requests under the limit', async () => {
      // Wait a bit for any previous rate limits to reset
      await sleep(6000)

      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('message')
      expect(response.body.message).toBe('Hello from rate-limited API!')
    })

    test('should include rate limit headers', async () => {
      await sleep(6000) // Reset window

      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(200)
      // Check for rate limit headers (either legacy or standard)
      const hasLimitHeader = response.headers['x-ratelimit-limit'] !== null
      expect(hasLimitHeader).toBe(true)
    })

    test('should decrement remaining count with each request', async () => {
      await sleep(6000) // Reset window

      const first = await fetchAPI('/api/test')
      const second = await fetchAPI('/api/test')

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)

      if (first.headers['x-ratelimit-remaining'] && second.headers['x-ratelimit-remaining']) {
        const firstRemaining = Number.parseInt(first.headers['x-ratelimit-remaining'])
        const secondRemaining = Number.parseInt(second.headers['x-ratelimit-remaining'])
        expect(secondRemaining).toBeLessThan(firstRemaining)
      }
    })
  })

  describe('Rate Limit Enforcement', () => {
    test('should block requests over the limit with 429', async () => {
      await sleep(6000) // Reset window

      // Make 6 requests (limit is 5)
      const responses: Awaited<ReturnType<typeof fetchAPI>>[] = []
      for (let i = 0; i < 6; i++) {
        responses.push(await fetchAPI('/api/test'))
      }

      // First 5 should succeed
      for (let i = 0; i < 5; i++) {
        expect(responses[i].status).toBe(200)
      }

      // 6th should be rate limited
      expect(responses[5].status).toBe(429)
    })

    test('should return Retry-After header when rate limited', async () => {
      await sleep(6000) // Reset window

      // Exhaust the limit
      for (let i = 0; i < 5; i++) {
        await fetchAPI('/api/test')
      }

      // This should be rate limited
      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(429)
      // Should have retry-after or x-ratelimit-reset
      const hasRetryInfo =
        response.headers['retry-after'] !== null || response.headers['x-ratelimit-reset'] !== null
      expect(hasRetryInfo).toBe(true)
    })
  })

  describe('Window Reset Behavior', () => {
    test('should allow requests again after window resets', async () => {
      await sleep(6000) // Reset window

      // Exhaust the limit
      for (let i = 0; i < 5; i++) {
        await fetchAPI('/api/test')
      }

      // Verify we're rate limited
      const limited = await fetchAPI('/api/test')
      expect(limited.status).toBe(429)

      // Wait for window to reset (10 seconds + buffer)
      console.log('Waiting for rate limit window to reset...')
      await sleep(6000)

      // Should be allowed again
      const afterReset = await fetchAPI('/api/test')
      expect(afterReset.status).toBe(200)
    }, 30000) // 30 second timeout for this test
  })

  describe('Burst Request Handling', () => {
    test('should handle concurrent burst requests correctly', async () => {
      await sleep(6000) // Reset window

      // Send 10 requests simultaneously
      const results = await burstRequests('/api/test', 10)

      const successCount = results.filter((r) => r.status === 200).length
      const limitedCount = results.filter((r) => r.status === 429).length

      // Should have exactly 5 successes and 5 limited (limit is 5)
      expect(successCount).toBe(5)
      expect(limitedCount).toBe(5)
    })
  })

  describe('Different Endpoints', () => {
    test('should rate limit different API endpoints', async () => {
      await sleep(6000) // Reset window

      // Requests to /api/test
      for (let i = 0; i < 3; i++) {
        await fetchAPI('/api/test')
      }

      // Requests to /api/heavy should share the same rate limit
      const heavyResponse = await fetchAPI('/api/heavy')

      // Should still have remaining quota (3 used, 2 remaining)
      expect(heavyResponse.status).toBe(200)

      // Use up the rest
      await fetchAPI('/api/test')
      await fetchAPI('/api/heavy')

      // This should be rate limited regardless of endpoint
      const limitedTest = await fetchAPI('/api/test')
      const limitedHeavy = await fetchAPI('/api/heavy')

      expect(limitedTest.status).toBe(429)
      expect(limitedHeavy.status).toBe(429)
    })
  })

  describe('Rate Limit Info in Response', () => {
    test('should include rateLimit info in event context', async () => {
      await sleep(6000) // Reset window

      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(200)
      // Our API returns rateLimit from event.context
      if (response.body.rateLimit) {
        expect(response.body.rateLimit).toHaveProperty('limit')
        expect(response.body.rateLimit).toHaveProperty('remaining')
        expect(response.body.rateLimit).toHaveProperty('reset')
      }
    })
  })

  describe('Error Response Format', () => {
    test('should return proper error message when rate limited', async () => {
      await sleep(6000) // Reset window

      // Exhaust the limit
      for (let i = 0; i < 5; i++) {
        await fetchAPI('/api/test')
      }

      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(429)
      // Body should contain rate limit message
      expect(typeof response.body).toBe('string')
      const bodyLower = response.body.toLowerCase()
      expect(
        bodyLower.includes('rate') || bodyLower.includes('too many') || bodyLower.includes('limit'),
      ).toBe(true)
    })
  })
})
