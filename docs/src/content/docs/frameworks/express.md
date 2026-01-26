---
title: Express
description: Rate limiting for Express applications
---

## Installation

```bash
npm install @jf/ratelimit-express
```

## Basic Usage

```ts
import express from "express";
import { rateLimiter } from "@jf/ratelimit-express";

const app = express();

app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
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
| `dryRun`          | `boolean`                            | `false`            | Log but don't block         |
| `onRateLimited`   | `(req, res, info) => void`           | -                  | Callback when limited       |

## Access Rate Limit Info

The rate limit info is attached to `req.rateLimit`:

```ts
app.get("/api/data", (req, res) => {
  console.log(req.rateLimit);
  // { limit: 100, remaining: 99, reset: 1234567890 }

  res.json({ data: "hello" });
});
```

## Custom Key Generator

```ts
app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    keyGenerator: (req) => {
      // Rate limit by user ID
      return req.user?.id ?? req.ip ?? "anonymous";
    },
  }),
);
```

## Skip Routes

```ts
app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    skip: (req) => {
      return req.path === "/health" || req.path.startsWith("/public/");
    },
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
        limit: info.limit,
        remaining: info.remaining,
      });
    },
  }),
);
```

## Header Options

```ts
// Legacy headers (default)
app.use(
  rateLimiter({
    legacyHeaders: true, // X-RateLimit-*
    standardHeaders: false,
  }),
);

// Standard headers only
app.use(
  rateLimiter({
    legacyHeaders: false,
    standardHeaders: true, // RateLimit-*
  }),
);

// Both
app.use(
  rateLimiter({
    legacyHeaders: true,
    standardHeaders: true,
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

## With Trust Proxy

When behind a reverse proxy:

```ts
app.set("trust proxy", 1);

app.use(
  rateLimiter({
    keyGenerator: (req) => req.ip, // Now correctly gets client IP
  }),
);
```
