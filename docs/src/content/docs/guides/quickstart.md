---
title: Quick Start
description: Get started with @jf/ratelimit in minutes
---

## Installation

Choose the package for your framework:

```bash
# For Hono
npm install @jf/ratelimit-hono

# For Express
npm install @jf/ratelimit-express

# For H3/Nitro
npm install @jf/ratelimit-h3

# For Nuxt
npm install @jf/ratelimit-nuxt
```

## Basic Usage

### Hono

```ts
import { Hono } from "hono";
import { rateLimiter } from "@jf/ratelimit-hono";

const app = new Hono();

// Apply rate limiting to all routes
app.use(
  rateLimiter({
    limit: 100, // 100 requests
    windowMs: 60_000, // per minute
  }),
);

app.get("/", (c) => c.text("Hello!"));

export default app;
```

### Express

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

### H3/Nitro

```ts
import { createApp, eventHandler } from "h3";
import { rateLimiter } from "@jf/ratelimit-h3";

const app = createApp();

app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
  }),
);

app.use(eventHandler(() => "Hello!"));

export default app;
```

### Nuxt

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@jf/ratelimit-nuxt"],
  rateLimit: {
    limit: 100,
    windowMs: 60_000,
  },
});
```

## Configuration Options

All framework adapters support these common options:

| Option         | Type                                 | Default            | Description                     |
| -------------- | ------------------------------------ | ------------------ | ------------------------------- |
| `limit`        | `number`                             | `60`               | Maximum requests per window     |
| `windowMs`     | `number`                             | `60000`            | Window duration in milliseconds |
| `algorithm`    | `'fixed-window' \| 'sliding-window'` | `'sliding-window'` | Rate limiting algorithm         |
| `store`        | `RateLimitStore`                     | `MemoryStore`      | Storage backend                 |
| `keyGenerator` | `function`                           | IP-based           | Function to generate client key |
| `skip`         | `function`                           | `undefined`        | Function to skip rate limiting  |
| `handler`      | `function`                           | Default 429        | Custom rate limit response      |
| `dryRun`       | `boolean`                            | `false`            | Log but don't block             |

## Custom Key Generator

Rate limit by user ID instead of IP:

```ts
app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    keyGenerator: (c) => c.req.header("X-User-ID") ?? "anonymous",
  }),
);
```

## Skip Certain Routes

```ts
app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    skip: (c) => c.req.path === "/health",
  }),
);
```

## Custom Response

```ts
app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    handler: (c, info) => {
      return c.json(
        {
          error: "Rate limit exceeded",
          retryAfter: Math.ceil((info.reset - Date.now()) / 1000),
        },
        429,
      );
    },
  }),
);
```

## Next Steps

- [Algorithms](/ratelimit/concepts/algorithms/) - Learn about fixed vs sliding window
- [Stores](/ratelimit/concepts/stores/) - Use Redis or other distributed stores
- [Framework Guides](/ratelimit/frameworks/hono/) - Deep dive into each framework
