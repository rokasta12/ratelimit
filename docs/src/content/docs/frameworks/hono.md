---
title: Hono
description: Rate limiting for Hono applications
---

## Installation

```bash
npm install @jf/ratelimit-hono
```

## Basic Usage

```ts
import { Hono } from "hono";
import { rateLimiter } from "@jf/ratelimit-hono";

const app = new Hono();

app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
  }),
);

app.get("/", (c) => c.text("Hello!"));

export default app;
```

## Options

| Option                   | Type                                                        | Default            | Description             |
| ------------------------ | ----------------------------------------------------------- | ------------------ | ----------------------- |
| `limit`                  | `number \| (c) => number`                                   | `60`               | Max requests per window |
| `windowMs`               | `number`                                                    | `60000`            | Window duration in ms   |
| `algorithm`              | `'fixed-window' \| 'sliding-window'`                        | `'sliding-window'` | Algorithm               |
| `store`                  | `RateLimitStore`                                            | `MemoryStore`      | Storage backend         |
| `keyGenerator`           | `(c) => string`                                             | IP-based           | Client identifier       |
| `skip`                   | `(c) => boolean`                                            | -                  | Skip rate limiting      |
| `handler`                | `(c, info) => Response`                                     | 429 response       | Custom handler          |
| `headers`                | `'legacy' \| 'draft-6' \| 'draft-7' \| 'standard' \| false` | `'legacy'`         | Header format           |
| `dryRun`                 | `boolean`                                                   | `false`            | Log but don't block     |
| `skipSuccessfulRequests` | `boolean`                                                   | `false`            | Don't count 2xx         |
| `onRateLimited`          | `(c, info) => void`                                         | -                  | Callback when limited   |

## Header Formats

### Legacy (default)

```ts
rateLimiter({ headers: "legacy" });
// X-RateLimit-Limit: 100
// X-RateLimit-Remaining: 99
// X-RateLimit-Reset: 1234567890
```

### Draft-6

```ts
rateLimiter({ headers: "draft-6" });
// RateLimit-Policy: 100;w=60
// RateLimit-Limit: 100
// RateLimit-Remaining: 99
// RateLimit-Reset: 60
```

### Draft-7

```ts
rateLimiter({ headers: "draft-7" });
// RateLimit-Policy: 100;w=60
// RateLimit: limit=100, remaining=99, reset=60
```

### Standard (IETF)

```ts
rateLimiter({ headers: "standard", identifier: "api" });
// RateLimit-Policy: "api";q=100;w=60
// RateLimit: "api";r=99;t=60
```

## Dynamic Limits

```ts
app.use(
  rateLimiter({
    limit: (c) => {
      const isPremium = c.req.header("X-Premium");
      return isPremium ? 1000 : 100;
    },
    windowMs: 60_000,
  }),
);
```

## Cloudflare Rate Limiting

For Cloudflare Workers with the Rate Limiting binding:

```ts
import { cloudflareRateLimiter } from "@jf/ratelimit-hono";

app.use(
  cloudflareRateLimiter({
    binding: env.RATE_LIMITER, // Your Cloudflare binding
    keyGenerator: (c) => c.req.header("CF-Connecting-IP") ?? "unknown",
  }),
);
```

## Access Rate Limit Info

```ts
app.get("/api/data", (c) => {
  const info = c.get("rateLimit");
  // { limit: 100, remaining: 99, reset: 1234567890 }

  const store = c.get("rateLimitStore");
  // Access store methods like store.resetKey(key)

  return c.json({ data: "hello" });
});
```

## Skip Routes

```ts
app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    skip: (c) => {
      // Skip health checks and static files
      return c.req.path === "/health" || c.req.path.startsWith("/static/");
    },
  }),
);
```

## Per-Route Limits

```ts
const strictLimiter = rateLimiter({ limit: 10, windowMs: 60_000 });
const normalLimiter = rateLimiter({ limit: 100, windowMs: 60_000 });

app.use("/api/sensitive/*", strictLimiter);
app.use("/api/*", normalLimiter);
```
