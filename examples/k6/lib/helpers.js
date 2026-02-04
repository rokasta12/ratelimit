import { check } from 'k6'

/**
 * Verify that legacy rate limit headers (X-RateLimit-*) are present and numeric.
 */
export function checkRateLimitHeaders(res) {
  check(res, {
    'has X-RateLimit-Limit header': (r) => r.headers['X-Ratelimit-Limit'] !== undefined,
    'has X-RateLimit-Remaining header': (r) => r.headers['X-Ratelimit-Remaining'] !== undefined,
    'has X-RateLimit-Reset header': (r) => r.headers['X-Ratelimit-Reset'] !== undefined,
    'X-RateLimit-Limit is numeric': (r) => !Number.isNaN(Number(r.headers['X-Ratelimit-Limit'])),
    'X-RateLimit-Remaining is numeric': (r) =>
      !Number.isNaN(Number(r.headers['X-Ratelimit-Remaining'])),
    'X-RateLimit-Reset is numeric': (r) => !Number.isNaN(Number(r.headers['X-Ratelimit-Reset'])),
  })
}

/**
 * Verify that the response is a 429 with Retry-After header.
 */
export function checkRateLimited(res) {
  check(res, {
    'status is 429': (r) => r.status === 429,
    'has Retry-After header': (r) => r.headers['Retry-After'] !== undefined,
  })
}

/**
 * Verify that the response is a 200 OK.
 */
export function checkAllowed(res) {
  check(res, {
    'status is 200': (r) => r.status === 200,
  })
}
