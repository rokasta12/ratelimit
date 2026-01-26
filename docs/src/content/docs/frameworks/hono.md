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
    binding: env.RATE_LIMITER,
    keyGenerator: (c) => c.req.header("CF-Connecting-IP") ?? "unknown",
  }),
);
```

## Access Rate Limit Info

```ts
app.get("/api/data", (c) => {
  const info = c.get("rateLimit");
  // { limit: 100, remaining: 99, reset: 1234567890 }

  return c.json({ data: "hello" });
});
```

## Per-Route Limits

```ts
const strictLimiter = rateLimiter({ limit: 10, windowMs: 60_000 });
const normalLimiter = rateLimiter({ limit: 100, windowMs: 60_000 });

app.use("/api/sensitive/*", strictLimiter);
app.use("/api/*", normalLimiter);
```
