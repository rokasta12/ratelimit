import { check } from 'k6'
import http from 'k6/http'
import { checkRateLimitHeaders } from '../lib/helpers.js'

/**
 * Header verification test.
 *
 * Sends a few requests to /api/public and verifies that
 * X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 * are present and have valid numeric values.
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

export const options = {
  vus: 1,
  iterations: 3,
  thresholds: {
    checks: ['rate==1.0'],
  },
}

export default function () {
  const res = http.get(`${BASE_URL}/api/public`)

  checkRateLimitHeaders(res)

  // Remaining should decrease with each request
  const remaining = Number(res.headers['X-Ratelimit-Remaining'])
  check(res, {
    'remaining decreases': () => remaining <= 10 - (__ITER + 1),
  })
}
