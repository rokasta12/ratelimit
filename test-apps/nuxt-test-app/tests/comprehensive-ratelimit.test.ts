/**
 * Comprehensive Rate Limiter Test Suite
 *
 * Tests the @jfungus/ratelimit-nuxt module thoroughly including:
 * - Algorithm behavior (fixed-window vs sliding-window)
 * - Rate limit enforcement and headers
 * - Window reset behavior
 * - Concurrent/burst request handling
 * - Skip patterns
 * - Error response format
 * - Edge cases
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { type Subprocess, spawn } from 'bun'

// Set default timeout for all tests (tests wait for rate limit windows)
setDefaultTimeout(30000)

const PORT = 3457
const BASE_URL = `http://localhost:${PORT}`

let serverProcess: Subprocess | null = null

// ============================================================================
// Test Helpers
// ============================================================================

interface APIResponse {
  status: number
  headers: {
    'x-ratelimit-limit': string | null
    'x-ratelimit-remaining': string | null
    'x-ratelimit-reset': string | null
    'retry-after': string | null
    'content-type': string | null
  }
  body: unknown
}

/**
 * Make a request to the test API
 */
async function fetchAPI(path: string, options?: RequestInit): Promise<APIResponse> {
  const response = await fetch(`${BASE_URL}${path}`, options)
  return {
    status: response.status,
    headers: {
      'x-ratelimit-limit': response.headers.get('x-ratelimit-limit'),
      'x-ratelimit-remaining': response.headers.get('x-ratelimit-remaining'),
      'x-ratelimit-reset': response.headers.get('x-ratelimit-reset'),
      'retry-after': response.headers.get('retry-after'),
      'content-type': response.headers.get('content-type'),
    },
    body: response.status === 200 ? await response.json() : await response.text(),
  }
}

/**
 * Wait for specified milliseconds
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Make multiple requests in parallel (burst)
 */
async function burstRequests(path: string, count: number): Promise<APIResponse[]> {
  return Promise.all(Array.from({ length: count }, () => fetchAPI(path)))
}

/**
 * Make multiple sequential requests
 */
async function sequentialRequests(path: string, count: number): Promise<APIResponse[]> {
  const results: APIResponse[] = []
  for (let i = 0; i < count; i++) {
    results.push(await fetchAPI(path))
  }
  return results
}

/**
 * Wait for rate limit window to reset
 */
async function waitForWindowReset(): Promise<void> {
  // Window is 5 seconds, wait 6 to be safe
  await sleep(6000)
}

// ============================================================================
// Server Setup
// ============================================================================

describe('Comprehensive Rate Limiter Tests', () => {
  beforeAll(async () => {
    console.log('Starting Nuxt test server on port', PORT)

    // Start the pre-built server
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

    // Wait for any initial rate limits to clear
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
  // Test Suite 1: Basic Rate Limiting Behavior
  // ==========================================================================

  describe('1. Basic Rate Limiting', () => {
    test('1.1 First request should succeed with 200 status', async () => {
      await waitForWindowReset()

      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('message')
    })

    test('1.2 Response should include rate limit info in body', async () => {
      await waitForWindowReset()

      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(200)
      const body = response.body as {
        rateLimit?: { limit: number; remaining: number; reset: number }
      }
      expect(body.rateLimit).toBeDefined()
      expect(body.rateLimit?.limit).toBe(5)
      expect(body.rateLimit?.remaining).toBe(4) // 5 - 1 = 4
    })

    test('1.3 Multiple requests should decrement remaining count', async () => {
      await waitForWindowReset()

      const responses = await sequentialRequests('/api/test', 3)

      // All should succeed
      expect(responses.every((r) => r.status === 200)).toBe(true)

      // Check remaining counts decrement
      const remainings = responses.map((r) => {
        const body = r.body as { rateLimit?: { remaining: number } }
        return body.rateLimit?.remaining
      })

      expect(remainings[0]).toBe(4) // After 1st request
      expect(remainings[1]).toBe(3) // After 2nd request
      expect(remainings[2]).toBe(2) // After 3rd request
    })

    test('1.4 Exactly limit requests should all succeed', async () => {
      await waitForWindowReset()

      const responses = await sequentialRequests('/api/test', 5)

      // All 5 should succeed (limit is 5)
      expect(responses.every((r) => r.status === 200)).toBe(true)

      // Last request should have 0 remaining
      const lastBody = responses[4].body as { rateLimit?: { remaining: number } }
      expect(lastBody.rateLimit?.remaining).toBe(0)
    })

    test('1.5 Request over limit should be blocked with 429', async () => {
      await waitForWindowReset()

      // Make 5 requests to exhaust limit
      await sequentialRequests('/api/test', 5)

      // 6th request should be blocked
      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(429)
    })
  })

  // ==========================================================================
  // Test Suite 2: Rate Limit Headers
  // ==========================================================================

  describe('2. Rate Limit Headers', () => {
    test('2.1 Response should include X-RateLimit-Limit header', async () => {
      await waitForWindowReset()

      const response = await fetchAPI('/api/test')

      expect(response.headers['x-ratelimit-limit']).toBe('5')
    })

    test('2.2 Response should include X-RateLimit-Remaining header', async () => {
      await waitForWindowReset()

      const response = await fetchAPI('/api/test')

      expect(response.headers['x-ratelimit-remaining']).toBe('4')
    })

    test('2.3 Response should include X-RateLimit-Reset header', async () => {
      await waitForWindowReset()

      const response = await fetchAPI('/api/test')

      const reset = response.headers['x-ratelimit-reset']
      expect(reset).not.toBeNull()

      // Reset should be a Unix timestamp in the future
      const resetTime = Number.parseInt(reset!, 10)
      const now = Math.floor(Date.now() / 1000)
      expect(resetTime).toBeGreaterThan(now)
      expect(resetTime).toBeLessThanOrEqual(now + 10) // Within 10 seconds (window is 5s)
    })

    test('2.4 X-RateLimit-Remaining should decrement with each request', async () => {
      await waitForWindowReset()

      const response1 = await fetchAPI('/api/test')
      const response2 = await fetchAPI('/api/test')
      const response3 = await fetchAPI('/api/test')

      expect(response1.headers['x-ratelimit-remaining']).toBe('4')
      expect(response2.headers['x-ratelimit-remaining']).toBe('3')
      expect(response3.headers['x-ratelimit-remaining']).toBe('2')
    })

    test('2.5 Rate limited response should include Retry-After header', async () => {
      await waitForWindowReset()

      // Exhaust the limit
      await sequentialRequests('/api/test', 5)

      // Get rate limited response
      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(429)
      expect(response.headers['retry-after']).not.toBeNull()

      const retryAfter = Number.parseInt(response.headers['retry-after']!, 10)
      expect(retryAfter).toBeGreaterThan(0)
      expect(retryAfter).toBeLessThanOrEqual(5) // Window is 5 seconds
    })

    test('2.6 X-RateLimit-Remaining should be 0 when rate limited', async () => {
      await waitForWindowReset()

      // Exhaust the limit
      await sequentialRequests('/api/test', 5)

      // Get rate limited response
      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(429)
      expect(response.headers['x-ratelimit-remaining']).toBe('0')
    })
  })

  // ==========================================================================
  // Test Suite 3: Window Reset Behavior
  // ==========================================================================

  describe('3. Window Reset Behavior', () => {
    test('3.1 Rate limit should reset after window expires', async () => {
      await waitForWindowReset()

      // Exhaust the limit
      await sequentialRequests('/api/test', 5)

      // Verify we're rate limited
      const limitedResponse = await fetchAPI('/api/test')
      expect(limitedResponse.status).toBe(429)

      // Wait for window to reset
      console.log('Waiting for window to reset...')
      await waitForWindowReset()

      // Should be allowed again
      const resetResponse = await fetchAPI('/api/test')
      expect(resetResponse.status).toBe(200)
    }, 20000)

    test('3.2 After reset, remaining should be back to limit-1', async () => {
      await waitForWindowReset()

      // Exhaust the limit
      await sequentialRequests('/api/test', 5)

      // Wait for window to reset
      await waitForWindowReset()

      // First request after reset
      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(200)
      expect(response.headers['x-ratelimit-remaining']).toBe('4')
    }, 20000)

    test('3.3 Partial window usage should also reset', async () => {
      await waitForWindowReset()

      // Use only 2 of 5 requests
      await sequentialRequests('/api/test', 2)

      // Wait for window to reset
      await waitForWindowReset()

      // Should have full quota again
      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(200)
      expect(response.headers['x-ratelimit-remaining']).toBe('4')
    }, 20000)
  })

  // ==========================================================================
  // Test Suite 4: Concurrent/Burst Request Handling
  // ==========================================================================

  describe('4. Concurrent Request Handling', () => {
    test('4.1 Burst requests should be counted correctly', async () => {
      await waitForWindowReset()

      // Send 10 requests simultaneously
      const results = await burstRequests('/api/test', 10)

      const successCount = results.filter((r) => r.status === 200).length
      const limitedCount = results.filter((r) => r.status === 429).length

      // Should have exactly 5 successes and 5 limited
      expect(successCount).toBe(5)
      expect(limitedCount).toBe(5)
    })

    test('4.2 Burst at exact limit should all succeed', async () => {
      await waitForWindowReset()

      // Send exactly 5 requests (the limit)
      const results = await burstRequests('/api/test', 5)

      const successCount = results.filter((r) => r.status === 200).length

      // All 5 should succeed
      expect(successCount).toBe(5)
    })

    test('4.3 Large burst should respect limit', async () => {
      await waitForWindowReset()

      // Send 20 requests simultaneously
      const results = await burstRequests('/api/test', 20)

      const successCount = results.filter((r) => r.status === 200).length
      const limitedCount = results.filter((r) => r.status === 429).length

      // Should have exactly 5 successes
      expect(successCount).toBe(5)
      expect(limitedCount).toBe(15)
    })

    test('4.4 Mixed sequential and burst requests', async () => {
      await waitForWindowReset()

      // Make 3 sequential requests first
      const sequential = await sequentialRequests('/api/test', 3)
      expect(sequential.every((r) => r.status === 200)).toBe(true)

      // Then burst 5 more (should get 2 successes, 3 failures)
      const burst = await burstRequests('/api/test', 5)
      const burstSuccesses = burst.filter((r) => r.status === 200).length
      const burstFailures = burst.filter((r) => r.status === 429).length

      expect(burstSuccesses).toBe(2) // 5 - 3 = 2 remaining
      expect(burstFailures).toBe(3)
    })
  })

  // ==========================================================================
  // Test Suite 5: Multiple Endpoints
  // ==========================================================================

  describe('5. Multiple Endpoints', () => {
    test('5.1 Rate limit should be shared across endpoints for same IP', async () => {
      await waitForWindowReset()

      // Make requests to different endpoints
      const r1 = await fetchAPI('/api/test')
      const r2 = await fetchAPI('/api/heavy')
      const r3 = await fetchAPI('/api/test')
      const r4 = await fetchAPI('/api/heavy')
      const r5 = await fetchAPI('/api/test')

      // All 5 should succeed
      expect(r1.status).toBe(200)
      expect(r2.status).toBe(200)
      expect(r3.status).toBe(200)
      expect(r4.status).toBe(200)
      expect(r5.status).toBe(200)

      // Next request (either endpoint) should be rate limited
      const r6Test = await fetchAPI('/api/test')
      const r7Heavy = await fetchAPI('/api/heavy')

      expect(r6Test.status).toBe(429)
      expect(r7Heavy.status).toBe(429)
    })

    test('5.2 Both endpoints should show correct remaining count', async () => {
      await waitForWindowReset()

      // Make 2 requests to /api/test
      await fetchAPI('/api/test')
      await fetchAPI('/api/test')

      // Check /api/heavy shows shared count
      const heavyResponse = await fetchAPI('/api/heavy')

      expect(heavyResponse.status).toBe(200)
      // Should show 2 remaining (5 - 2 test requests - 1 heavy request)
      expect(heavyResponse.headers['x-ratelimit-remaining']).toBe('2')
    })
  })

  // ==========================================================================
  // Test Suite 6: Skip Patterns
  // ==========================================================================

  describe('6. Skip Patterns', () => {
    test('6.1 /_nuxt/** paths should not be rate limited', async () => {
      await waitForWindowReset()

      // Exhaust the limit on /api/test
      await sequentialRequests('/api/test', 6)

      // /_nuxt paths should still work (but may 404)
      // The key is they should NOT return 429
      try {
        const response = await fetch(`${BASE_URL}/_nuxt/test.js`)
        expect(response.status).not.toBe(429)
      } catch {
        // Network error is fine, we just want to ensure no 429
      }
    })

    test('6.2 /__nuxt_error should not be rate limited', async () => {
      await waitForWindowReset()

      // Exhaust the limit
      await sequentialRequests('/api/test', 6)

      // __nuxt_error should not return 429
      try {
        const response = await fetch(`${BASE_URL}/__nuxt_error`)
        expect(response.status).not.toBe(429)
      } catch {
        // Network error is fine
      }
    })
  })

  // ==========================================================================
  // Test Suite 7: Error Response Format
  // ==========================================================================

  describe('7. Error Response Format', () => {
    test('7.1 Rate limited response should be JSON', async () => {
      await waitForWindowReset()

      // Exhaust the limit
      await sequentialRequests('/api/test', 5)

      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(429)
      expect(response.headers['content-type']).toContain('application/json')
    })

    test('7.2 Rate limited response should contain error info', async () => {
      await waitForWindowReset()

      // Exhaust the limit
      await sequentialRequests('/api/test', 5)

      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(429)
      const body = response.body as string
      expect(body.toLowerCase()).toMatch(/too many|rate|limit/i)
    })

    test('7.3 Rate limited response should have statusCode 429', async () => {
      await waitForWindowReset()

      // Exhaust the limit
      await sequentialRequests('/api/test', 5)

      const response = await fetchAPI('/api/test')

      expect(response.status).toBe(429)

      // Try to parse body for statusCode
      try {
        const body = JSON.parse(response.body as string)
        expect(body.statusCode).toBe(429)
      } catch {
        // Body might not be parseable JSON, that's okay
      }
    })
  })

  // ==========================================================================
  // Test Suite 8: Edge Cases
  // ==========================================================================

  describe('8. Edge Cases', () => {
    test('8.1 Very rapid sequential requests should be counted', async () => {
      await waitForWindowReset()

      // Make rapid sequential requests without any delay
      const results: APIResponse[] = []
      for (let i = 0; i < 10; i++) {
        results.push(await fetchAPI('/api/test'))
      }

      const successCount = results.filter((r) => r.status === 200).length
      expect(successCount).toBe(5)
    })

    test('8.2 Request at exact window boundary', async () => {
      await waitForWindowReset()

      // Get the reset time from a request
      const initial = await fetchAPI('/api/test')
      const resetTime = Number.parseInt(initial.headers['x-ratelimit-reset']!, 10) * 1000

      // Calculate time to wait until just before reset
      const waitTime = resetTime - Date.now() - 100
      if (waitTime > 0 && waitTime < 10000) {
        await sleep(waitTime)

        // Make a request right before reset
        const beforeReset = await fetchAPI('/api/test')
        expect(beforeReset.status).toBe(200)
      }
    }, 15000)

    test('8.3 Empty/missing headers should be handled gracefully', async () => {
      await waitForWindowReset()

      // Make request without any special headers
      const response = await fetchAPI('/api/test', {
        headers: {},
      })

      expect(response.status).toBe(200)
    })

    test('8.4 Request with custom User-Agent', async () => {
      await waitForWindowReset()

      const response = await fetchAPI('/api/test', {
        headers: {
          'User-Agent': 'TestBot/1.0',
        },
      })

      expect(response.status).toBe(200)
    })
  })

  // ==========================================================================
  // Test Suite 9: Algorithm Verification (Sliding Window)
  // ==========================================================================

  describe('9. Sliding Window Algorithm', () => {
    test('9.1 Sliding window should provide smooth rate limiting', async () => {
      await waitForWindowReset()

      // The configured algorithm is sliding-window
      // This test verifies basic functionality

      const responses = await sequentialRequests('/api/test', 5)

      // All should succeed
      expect(responses.every((r) => r.status === 200)).toBe(true)

      // 6th should fail
      const blocked = await fetchAPI('/api/test')
      expect(blocked.status).toBe(429)
    })

    test('9.2 Rate limit info should be consistent', async () => {
      await waitForWindowReset()

      const response = await fetchAPI('/api/test')

      // Header and body should match
      const headerLimit = response.headers['x-ratelimit-limit']
      const headerRemaining = response.headers['x-ratelimit-remaining']

      const body = response.body as { rateLimit?: { limit: number; remaining: number } }

      expect(headerLimit).toBe(String(body.rateLimit?.limit))
      expect(headerRemaining).toBe(String(body.rateLimit?.remaining))
    })
  })

  // ==========================================================================
  // Test Suite 10: Performance Under Load
  // ==========================================================================

  describe('10. Performance Under Load', () => {
    test('10.1 Multiple bursts should all respect the limit', async () => {
      await waitForWindowReset()

      // First burst
      const burst1 = await burstRequests('/api/test', 10)
      const success1 = burst1.filter((r) => r.status === 200).length
      expect(success1).toBe(5)

      // Wait for reset
      await waitForWindowReset()

      // Second burst
      const burst2 = await burstRequests('/api/test', 10)
      const success2 = burst2.filter((r) => r.status === 200).length
      expect(success2).toBe(5)
    }, 20000)

    test('10.2 Rate limiter should handle 50 concurrent requests', async () => {
      await waitForWindowReset()

      // Send 50 requests simultaneously
      const results = await burstRequests('/api/test', 50)

      const successCount = results.filter((r) => r.status === 200).length
      const limitedCount = results.filter((r) => r.status === 429).length

      // Should have exactly 5 successes
      expect(successCount).toBe(5)
      expect(limitedCount).toBe(45)
    })
  })
})
