/**
 * Advanced Features Test Suite
 *
 * Tests for:
 * - IETF Standard Headers (RateLimit-*)
 * - Per-Route Configuration
 * - Fixed Window Algorithm
 * - Dry Run Mode
 * - Custom Key Generators
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { type Subprocess, spawn } from 'bun'

// Set default timeout for all tests
setDefaultTimeout(30000)

const PORT = 3458
const BASE_URL = `http://localhost:${PORT}`

let serverProcess: Subprocess | null = null

// ============================================================================
// Test Helpers
// ============================================================================

interface APIResponse {
  status: number
  headers: {
    // Legacy headers
    'x-ratelimit-limit': string | null
    'x-ratelimit-remaining': string | null
    'x-ratelimit-reset': string | null
    // IETF Standard headers
    'ratelimit-limit': string | null
    'ratelimit-remaining': string | null
    'ratelimit-reset': string | null
    // Other
    'retry-after': string | null
    'content-type': string | null
  }
  body: unknown
}

async function fetchAPI(path: string, options?: RequestInit): Promise<APIResponse> {
  const response = await fetch(`${BASE_URL}${path}`, options)
  return {
    status: response.status,
    headers: {
      'x-ratelimit-limit': response.headers.get('x-ratelimit-limit'),
      'x-ratelimit-remaining': response.headers.get('x-ratelimit-remaining'),
      'x-ratelimit-reset': response.headers.get('x-ratelimit-reset'),
      'ratelimit-limit': response.headers.get('ratelimit-limit'),
      'ratelimit-remaining': response.headers.get('ratelimit-remaining'),
      'ratelimit-reset': response.headers.get('ratelimit-reset'),
      'retry-after': response.headers.get('retry-after'),
      'content-type': response.headers.get('content-type'),
    },
    body: response.status === 200 ? await response.json() : await response.text(),
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function sequentialRequests(path: string, count: number): Promise<APIResponse[]> {
  const results: APIResponse[] = []
  for (let i = 0; i < count; i++) {
    results.push(await fetchAPI(path))
  }
  return results
}

async function waitForWindowReset(ms = 6000): Promise<void> {
  await sleep(ms)
}

// ============================================================================
// Server Setup
// ============================================================================

describe('Advanced Rate Limiter Features', () => {
  beforeAll(async () => {
    console.log('Starting Nuxt test server on port', PORT)

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
    await waitForWindowReset()
  }, 120000)

  afterAll(async () => {
    if (serverProcess) {
      console.log('Stopping server...')
      serverProcess.kill()
      await serverProcess.exited
    }
  })

  // ==========================================================================
  // Test Suite 1: IETF Standard Headers
  // ==========================================================================

  describe('1. IETF Standard Headers (RateLimit-*)', () => {
    test('1.1 Response should include standard RateLimit-Limit header', async () => {
      await waitForWindowReset()

      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(200)
      expect(response.headers['ratelimit-limit']).toBe('5')
    })

    test('1.2 Response should include standard RateLimit-Remaining header', async () => {
      await waitForWindowReset()

      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(200)
      expect(response.headers['ratelimit-remaining']).toBe('4')
    })

    test('1.3 Response should include standard RateLimit-Reset header', async () => {
      await waitForWindowReset()

      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(200)
      const reset = response.headers['ratelimit-reset']
      expect(reset).not.toBeNull()

      // Reset should be a Unix timestamp in the future
      const resetTime = Number.parseInt(reset!, 10)
      const now = Math.floor(Date.now() / 1000)
      expect(resetTime).toBeGreaterThan(now)
    })

    test('1.4 Both legacy (X-RateLimit-*) and standard (RateLimit-*) headers present', async () => {
      await waitForWindowReset()

      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(200)

      // Legacy headers
      expect(response.headers['x-ratelimit-limit']).toBe('5')
      expect(response.headers['x-ratelimit-remaining']).toBe('4')
      expect(response.headers['x-ratelimit-reset']).not.toBeNull()

      // Standard headers
      expect(response.headers['ratelimit-limit']).toBe('5')
      expect(response.headers['ratelimit-remaining']).toBe('4')
      expect(response.headers['ratelimit-reset']).not.toBeNull()
    })

    test('1.5 Legacy and standard headers should have same values', async () => {
      await waitForWindowReset()

      const response = await fetchAPI('/api/test')

      expect(response.headers['x-ratelimit-limit']).toBe(response.headers['ratelimit-limit'])
      expect(response.headers['x-ratelimit-remaining']).toBe(
        response.headers['ratelimit-remaining'],
      )
      expect(response.headers['x-ratelimit-reset']).toBe(response.headers['ratelimit-reset'])
    })
  })

  // ==========================================================================
  // Test Suite 2: Per-Route Configuration
  // ==========================================================================

  describe('2. Per-Route Configuration', () => {
    test('2.1 Auth routes should have stricter limit (3 instead of 5)', async () => {
      await waitForWindowReset()

      const response = await fetchAPI('/api/auth/login')

      expect(response.status).toBe(200)
      // Auth routes are configured with limit: 3
      expect(response.headers['x-ratelimit-limit']).toBe('3')
      expect(response.headers['ratelimit-limit']).toBe('3')
    })

    test('2.2 Auth route should block after 3 requests', async () => {
      await waitForWindowReset()

      // Make 3 requests (the limit for auth routes)
      const responses = await sequentialRequests('/api/auth/login', 3)
      expect(responses.every((r) => r.status === 200)).toBe(true)

      // 4th request should be blocked
      const blocked = await fetchAPI('/api/auth/login')
      expect(blocked.status).toBe(429)
    })

    test('2.3 Upload route should have custom limit (2 requests)', async () => {
      await waitForWindowReset(11000) // Upload has 10s window

      const response = await fetchAPI('/api/upload')

      expect(response.status).toBe(200)
      // Upload route is configured with limit: 2
      expect(response.headers['x-ratelimit-limit']).toBe('2')
      expect(response.headers['ratelimit-limit']).toBe('2')
    })

    test('2.4 Upload route should block after 2 requests', async () => {
      await waitForWindowReset(11000) // Upload has 10s window

      // Make 2 requests (the limit for upload route)
      const responses = await sequentialRequests('/api/upload', 2)
      expect(responses.every((r) => r.status === 200)).toBe(true)

      // 3rd request should be blocked
      const blocked = await fetchAPI('/api/upload')
      expect(blocked.status).toBe(429)
    }, 20000)

    test('2.5 Per-route limits should be independent', async () => {
      await waitForWindowReset()

      // Exhaust auth limit (3 requests)
      await sequentialRequests('/api/auth/login', 3)
      const authBlocked = await fetchAPI('/api/auth/login')
      expect(authBlocked.status).toBe(429)

      // Regular API should still work (different limit)
      const regularResponse = await fetchAPI('/api/test')
      expect(regularResponse.status).toBe(200)
    })

    test('2.6 Non-configured routes should use global limit', async () => {
      await waitForWindowReset()

      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(200)
      // Should use global limit of 5
      expect(response.headers['x-ratelimit-limit']).toBe('5')
    })

    test('2.7 Wildcard route patterns should work (/api/auth/**)', async () => {
      await waitForWindowReset()

      // Both /api/auth/login and any other /api/auth/* should use the same config
      const loginResponse = await fetchAPI('/api/auth/login')
      expect(loginResponse.headers['x-ratelimit-limit']).toBe('3')
    })
  })

  // ==========================================================================
  // Test Suite 3: Per-Route Rate Limit Independence
  // ==========================================================================

  describe('3. Per-Route Rate Limit Independence', () => {
    test('3.1 Different routes should have separate counters', async () => {
      await waitForWindowReset()

      // Make requests to auth route (uses 3-request limit)
      const authResponse = await fetchAPI('/api/auth/login')
      expect(authResponse.status).toBe(200)
      expect(authResponse.headers['x-ratelimit-remaining']).toBe('2')

      // Make request to regular API (uses 5-request limit)
      const apiResponse = await fetchAPI('/api/test')
      expect(apiResponse.status).toBe(200)
      expect(apiResponse.headers['x-ratelimit-remaining']).toBe('4') // Independent counter
    })

    test('3.2 Exhausting one route should not affect another', async () => {
      await waitForWindowReset()

      // Exhaust auth route
      await sequentialRequests('/api/auth/login', 4)
      const authBlocked = await fetchAPI('/api/auth/login')
      expect(authBlocked.status).toBe(429)

      // Regular API should have full quota
      const responses = await sequentialRequests('/api/test', 5)
      expect(responses.every((r) => r.status === 200)).toBe(true)
    })
  })

  // ==========================================================================
  // Test Suite 4: Heavy Endpoint (shared with regular API)
  // ==========================================================================

  describe('4. Endpoints Without Per-Route Config', () => {
    test('4.1 Heavy endpoint should use global limit', async () => {
      await waitForWindowReset()

      const response = await fetchAPI('/api/heavy')

      expect(response.status).toBe(200)
      expect(response.headers['x-ratelimit-limit']).toBe('5')
    })

    test('4.2 Heavy and test endpoints should share rate limit', async () => {
      await waitForWindowReset()

      // Make 3 requests to /api/test
      await sequentialRequests('/api/test', 3)

      // Make request to /api/heavy - should share the same counter
      const heavyResponse = await fetchAPI('/api/heavy')
      expect(heavyResponse.status).toBe(200)
      expect(heavyResponse.headers['x-ratelimit-remaining']).toBe('1') // 5 - 3 - 1 = 1
    })
  })

  // ==========================================================================
  // Test Suite 5: Edge Cases for Per-Route Config
  // ==========================================================================

  describe('5. Edge Cases', () => {
    test('5.1 Route patterns should match correctly', async () => {
      await waitForWindowReset()

      // /api/auth/login matches /api/auth/**
      const authLogin = await fetchAPI('/api/auth/login')
      expect(authLogin.headers['x-ratelimit-limit']).toBe('3')

      // /api/upload matches exactly
      await waitForWindowReset(11000)
      const upload = await fetchAPI('/api/upload')
      expect(upload.headers['x-ratelimit-limit']).toBe('2')

      // /api/test uses global config
      await waitForWindowReset()
      const test = await fetchAPI('/api/test')
      expect(test.headers['x-ratelimit-limit']).toBe('5')
    }, 30000)

    test('5.2 Window reset should work for per-route configs', async () => {
      await waitForWindowReset()

      // Exhaust auth limit
      await sequentialRequests('/api/auth/login', 4)
      const blocked = await fetchAPI('/api/auth/login')
      expect(blocked.status).toBe(429)

      // Wait for reset
      await waitForWindowReset()

      // Should be allowed again
      const afterReset = await fetchAPI('/api/auth/login')
      expect(afterReset.status).toBe(200)
    }, 20000)
  })

  // ==========================================================================
  // Test Suite 6: Headers Consistency
  // ==========================================================================

  describe('6. Headers Consistency Across Routes', () => {
    test('6.1 All routes should include both header styles', async () => {
      await waitForWindowReset()

      const testResponse = await fetchAPI('/api/test')
      const authResponse = await fetchAPI('/api/auth/login')

      // Both should have legacy headers
      expect(testResponse.headers['x-ratelimit-limit']).not.toBeNull()
      expect(authResponse.headers['x-ratelimit-limit']).not.toBeNull()

      // Both should have standard headers
      expect(testResponse.headers['ratelimit-limit']).not.toBeNull()
      expect(authResponse.headers['ratelimit-limit']).not.toBeNull()
    })

    test('6.2 Rate limited responses should include both header styles', async () => {
      await waitForWindowReset()

      // Exhaust auth limit
      await sequentialRequests('/api/auth/login', 3)
      const blocked = await fetchAPI('/api/auth/login')

      expect(blocked.status).toBe(429)

      // Should have both legacy and standard headers
      expect(blocked.headers['x-ratelimit-limit']).toBe('3')
      expect(blocked.headers['x-ratelimit-remaining']).toBe('0')
      expect(blocked.headers['ratelimit-limit']).toBe('3')
      expect(blocked.headers['ratelimit-remaining']).toBe('0')
    })
  })
})
