# k6 Load Tests

Framework-agnostic load test scripts for testing rate limiting behavior. These scripts work with any of the example apps (Express, Hono, H3, Nuxt).

## Prerequisites

Install k6: https://k6.io/docs/getting-started/installation/

```bash
# macOS
brew install k6

# Debian/Ubuntu
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Windows
choco install k6
```

## Usage

Start any example app first (defaults to port 3000):

```bash
# From monorepo root
pnpm --filter @jfungus/example-express dev
```

Then run k6 scripts:

```bash
k6 run examples/k6/scripts/basic.js
```

### Configuring the target URL

All scripts default to `http://localhost:3000`. Override with:

```bash
k6 run examples/k6/scripts/basic.js -e BASE_URL=http://localhost:4000
```

## Scripts

### `scripts/basic.js`

Tests basic rate limit enforcement. Sends 15 sequential requests to `/api/public` (limit: 10 req/min). Validates that the first 10 return 200 and the rest return 429.

```bash
k6 run examples/k6/scripts/basic.js
```

### `scripts/headers.js`

Verifies rate limit headers are present and have valid numeric values. Checks for `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.

```bash
k6 run examples/k6/scripts/headers.js
```

### `scripts/per-route.js`

Tests that different routes have independent rate limit counters. Hits `/api/auth/login` (limit: 5) until blocked, then verifies `/api/public` (limit: 10) is still accessible.

```bash
k6 run examples/k6/scripts/per-route.js
```

### `scripts/concurrent.js`

Tests that concurrent users with different IPs get independent rate limit buckets. Uses 5 virtual users each with a unique `X-Forwarded-For` header.

```bash
k6 run examples/k6/scripts/concurrent.js
```

## Shared Helpers

`lib/helpers.js` provides reusable check functions:

- `checkRateLimitHeaders(res)` — Verify X-RateLimit-* headers exist and are numeric
- `checkRateLimited(res)` — Verify response is 429 with Retry-After header
- `checkAllowed(res)` — Verify response is 200
