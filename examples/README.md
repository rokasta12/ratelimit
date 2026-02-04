# Examples

Example applications demonstrating `@jfungus/ratelimit` across all supported frameworks.

## Prerequisites

- Node.js 18+
- pnpm 9+
- [k6](https://k6.io/docs/getting-started/installation/) (for load tests)

## Quick Start

From the **monorepo root**, build all packages first:

```bash
pnpm install
pnpm build
```

Then run any example:

```bash
# Express
pnpm --filter @jfungus/example-express dev

# Hono
pnpm --filter @jfungus/example-hono dev

# H3
pnpm --filter @jfungus/example-h3 dev

# Nuxt
pnpm --filter @jfungus/example-nuxt dev
```

All examples listen on `http://localhost:3000` by default (configurable via `PORT` env var).

## API Surface

Every example exposes the same endpoints:

| Route | Method | Rate Limit | Purpose |
|---|---|---|---|
| `/` | GET | 10 req/min | Root status |
| `/api/public` | GET | 10 req/min | Public endpoint |
| `/api/auth/login` | POST | 5 req/min | Auth demo (strict) |
| `/api/upload` | POST | 3 req/5min | Upload demo (strict) |
| `/api/health` | GET | Skipped | Health check (no rate limit) |
| `/api/custom-key` | GET | 10 req/min by `?user=` | Custom key demo (Express, Hono, H3 only) |

## Rate Limit Headers

All examples return these headers on rate-limited routes:

```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
X-RateLimit-Reset: 1706745600
```

When a request is rate limited (429), you also get:

```
Retry-After: 45
```

## Running k6 Load Tests

With an example running on port 3000:

```bash
# Basic enforcement — sends 15 requests, expects 429 after 10
k6 run examples/k6/scripts/basic.js

# Header verification
k6 run examples/k6/scripts/headers.js

# Per-route independent counters
k6 run examples/k6/scripts/per-route.js

# Concurrent users with separate rate limit buckets
k6 run examples/k6/scripts/concurrent.js
```

Target a different host:

```bash
k6 run examples/k6/scripts/basic.js -e BASE_URL=http://localhost:4000
```

See [`k6/README.md`](./k6/README.md) for more details.

## Docker

Each example includes a Dockerfile. Build from the **monorepo root**:

```bash
# Express
docker build -f examples/express/Dockerfile -t ratelimit-express .
docker run -p 3000:3000 ratelimit-express

# Hono
docker build -f examples/hono/Dockerfile -t ratelimit-hono .
docker run -p 3000:3000 ratelimit-hono

# H3
docker build -f examples/h3/Dockerfile -t ratelimit-h3 .
docker run -p 3000:3000 ratelimit-h3

# Nuxt
docker build -f examples/nuxt/Dockerfile -t ratelimit-nuxt .
docker run -p 3000:3000 ratelimit-nuxt
```

## Framework Comparison

| Feature | Express | Hono | H3 | Nuxt |
|---|---|---|---|---|
| Middleware type | `RequestHandler` | `MiddlewareHandler` | `EventHandler` | Nuxt module |
| Rate limit info | `req.rateLimit` | `c.get('rateLimit')` | `event.context.rateLimit` | `event.context.rateLimit` |
| Per-route config | Separate middleware | Separate middleware | `defineEventHandler({ onRequest })` | `routes` in `nuxt.config.ts` |
| Skip health check | Route order | `skip` option | `skip` option | `skip` array |
| Header format | `legacyHeaders` / `standardHeaders` | `headers: 'legacy'` | Always X-RateLimit-* | `headerStyle` in config |
