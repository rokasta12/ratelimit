import http from 'k6/http'
import { checkAllowed, checkRateLimited } from '../lib/helpers.js'

/**
 * Basic rate limit enforcement test.
 *
 * Sends 15 requests to /api/public (limit: 10 req/min).
 * First 10 should return 200, the rest should return 429.
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

export const options = {
  vus: 1,
  iterations: 15,
  thresholds: {
    checks: ['rate>=0.9'],
  },
}

export default function () {
  const res = http.get(`${BASE_URL}/api/public`)

  if (__ITER < 10) {
    checkAllowed(res)
  } else {
    checkRateLimited(res)
  }
}
