import { check } from 'k6'
import http from 'k6/http'

/**
 * Concurrent users test.
 *
 * 5 VUs each send 12 requests to /api/public (limit: 10 req/min).
 * Each VU uses a unique X-Forwarded-For IP so they get separate buckets.
 *
 * Each VU: first 10 should pass, last 2 should be rate limited.
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

export const options = {
  scenarios: {
    concurrent: {
      executor: 'per-vu-iterations',
      vus: 5,
      iterations: 12,
    },
  },
  thresholds: {
    checks: ['rate>=0.85'],
  },
}

export default function () {
  const vuIP = `10.0.0.${__VU}`

  const res = http.get(`${BASE_URL}/api/public`, {
    headers: {
      'X-Forwarded-For': vuIP,
    },
  })

  // __ITER is per-VU (0..11) with per-vu-iterations executor
  if (__ITER < 10) {
    check(res, {
      'within limit — status is 200': (r) => r.status === 200,
    })
  } else {
    check(res, {
      'over limit — status is 429': (r) => r.status === 429,
    })
  }
}
