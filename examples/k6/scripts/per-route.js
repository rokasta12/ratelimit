import { check } from 'k6'
import http from 'k6/http'
import { checkAllowed, checkRateLimited } from '../lib/helpers.js'

/**
 * Per-route rate limit test.
 *
 * Tests that /api/auth/login (5 req/min) and /api/public (10 req/min)
 * have independent counters.
 *
 * Phase 1 (iterations 0-5): Hit /api/auth/login 6 times — 5 pass, 1 blocked
 * Phase 2 (iterations 6-11): Hit /api/public 6 times — all 6 should pass
 *   (proves login counter doesn't affect public counter)
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

export const options = {
  vus: 1,
  iterations: 12,
  thresholds: {
    checks: ['rate>=0.9'],
  },
}

export default function () {
  if (__ITER < 6) {
    // Phase 1: auth/login — limit 5
    const res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({}), {
      headers: { 'Content-Type': 'application/json' },
    })

    if (__ITER < 5) {
      checkAllowed(res)
    } else {
      checkRateLimited(res)
    }
  } else {
    // Phase 2: public — limit 10 (independent counter)
    const res = http.get(`${BASE_URL}/api/public`)

    check(res, {
      'public endpoint still allowed after login limit hit': (r) => r.status === 200,
    })
  }
}
