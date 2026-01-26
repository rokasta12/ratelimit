---
title: "@jfungus/ratelimit-express"
description: "Rate limiting middleware for Express.js. Protect your Express APIs with sliding window rate limiting and Redis support."
---

Rate limiting middleware for [Express](https://expressjs.com/) - the most popular Node.js web framework.

## Installation

```bash
npm install @jfungus/ratelimit-express
```

## Basic Usage

```ts
import express from "express";
import { rateLimiter } from "@jfungus/ratelimit-express";

const app = express();

app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000, // 1 minute
  }),
);

app.get("/", (req, res) => res.send("Hello!"));

app.listen(3000);
```

## Options

| Option            | Type                                 | Default            | Description                 |
| ----------------- | ------------------------------------ | ------------------ | --------------------------- |
| `limit`           | `number \| (req) => number`          | `60`               | Max requests per window     |
| `windowMs`        | `number`                             | `60000`            | Window duration in ms       |
| `algorithm`       | `'fixed-window' \| 'sliding-window'` | `'sliding-window'` | Algorithm                   |
| `store`           | `RateLimitStore`                     | `MemoryStore`      | Storage backend             |
| `keyGenerator`    | `(req) => string`                    | IP-based           | Client identifier           |
| `skip`            | `(req) => boolean`                   | -                  | Skip rate limiting          |
| `handler`         | `(req, res, info) => void`           | 429 response       | Custom handler              |
| `legacyHeaders`   | `boolean`                            | `true`             | Send X-RateLimit-\* headers |
| `standardHeaders` | `boolean`                            | `false`            | Send RateLimit-\* headers   |

## Access Rate Limit Info

```ts
app.get("/api/data", (req, res) => {
  console.log(req.rateLimit);
  // { limit: 100, remaining: 99, reset: 1234567890 }

  res.json({ data: "hello" });
});
```

## Custom Key Generator

Rate limit by user ID instead of IP:

```ts
app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? "anonymous",
  }),
);
```

## Custom Response

```ts
app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    handler: (req, res, info) => {
      res.status(429).json({
        error: "Too Many Requests",
        retryAfter: Math.ceil((info.reset - Date.now()) / 1000),
      });
    },
  }),
);
```

## Per-Route Limits

```ts
const apiLimiter = rateLimiter({ limit: 100, windowMs: 60_000 });
const authLimiter = rateLimiter({ limit: 5, windowMs: 60_000 });

app.use("/api/", apiLimiter);
app.use("/auth/", authLimiter);
```

## Behind a Proxy

When behind nginx, AWS ELB, or similar:

```ts
app.set("trust proxy", 1);

app.use(
  rateLimiter({
    keyGenerator: (req) => req.ip, // Now correctly gets client IP
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

- [Express Documentation](https://expressjs.com/)
- [Stores](/ratelimit/concepts/stores/) - Redis, KV storage
- [@jfungus/ratelimit-unstorage](/ratelimit/packages/unstorage/) - Storage adapter
