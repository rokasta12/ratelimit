---
title: "@jfungus/ratelimit-hono"
description: "Rate limiting middleware for Hono framework. Protect your Hono APIs and Cloudflare Workers with sliding window rate limiting."
---

Rate limiting middleware for [Hono](https://hono.dev/) - the fast, lightweight web framework for Edge runtimes.

## Installation

```bash
npm install @jfungus/ratelimit-hono
```

## Basic Usage

```ts
import { Hono } from "hono";
import { rateLimiter } from "@jfungus/ratelimit-hono";

const app = new Hono();

app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000, // 1 minute
  }),
);

app.get("/", (c) => c.text("Hello!"));

export default app;
```

## Options

| Option         | Type                                 | Default            | Description             |
| -------------- | ------------------------------------ | ------------------ | ----------------------- |
| `limit`        | `number \| (c) => number`            | `60`               | Max requests per window |
| `windowMs`     | `number`                             | `60000`            | Window duration in ms   |
| `algorithm`    | `'fixed-window' \| 'sliding-window'` | `'sliding-window'` | Algorithm               |
| `store`        | `RateLimitStore`                     | `MemoryStore`      | Storage backend         |
| `keyGenerator` | `(c) => string`                      | IP-based           | Client identifier       |
| `skip`         | `(c) => boolean`                     | -                  | Skip rate limiting      |
| `handler`      | `(c, info) => Response`              | 429 response       | Custom handler          |
| `dryRun`       | `boolean`                            | `false`            | Log but don't block     |

## Dynamic Limits

Different limits for different users:

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

## Per-Route Limits

```ts
const strictLimiter = rateLimiter({ limit: 10, windowMs: 60_000 });
const normalLimiter = rateLimiter({ limit: 100, windowMs: 60_000 });

app.use("/api/auth/*", strictLimiter);
app.use("/api/*", normalLimiter);
```

## Access Rate Limit Info

```ts
app.get("/api/data", (c) => {
  const info = c.get("rateLimit");
  // { limit: 100, remaining: 99, reset: 1234567890 }

  return c.json({ data: "hello", remaining: info.remaining });
});
```

## Cloudflare Workers

For native Cloudflare rate limiting:

```ts
import { cloudflareRateLimiter } from "@jfungus/ratelimit-hono";

app.use(
  cloudflareRateLimiter({
    binding: env.RATE_LIMITER,
    keyGenerator: (c) => c.req.header("CF-Connecting-IP") ?? "unknown",
  }),
);
```

## With Redis

```ts
import { createStorage } from "unstorage";
import redisDriver from "unstorage/drivers/redis";
import { createUnstorageStore } from "@jfungus/ratelimit-unstorage";

const store = createUnstorageStore({
  storage: createStorage({
    driver: redisDriver({ url: process.env.REDIS_URL }),
  }),
});

app.use(rateLimiter({ limit: 100, windowMs: 60_000, store }));
```

## Related

- [Hono Documentation](https://hono.dev/)
- [Stores](/ratelimit/concepts/stores/) - Redis, KV storage
- [@jfungus/ratelimit-unstorage](/ratelimit/packages/unstorage/) - Storage adapter
