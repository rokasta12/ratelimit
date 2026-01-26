# @jfungus/ratelimit-hono

[![npm version](https://img.shields.io/npm/v/@jfungus/ratelimit-hono)](https://www.npmjs.com/package/@jfungus/ratelimit-hono)
[![npm downloads](https://img.shields.io/npm/dm/@jfungus/ratelimit-hono)](https://www.npmjs.com/package/@jfungus/ratelimit-hono)
[![CI](https://github.com/rokasta12/ratelimit/actions/workflows/ci.yml/badge.svg)](https://github.com/rokasta12/ratelimit/actions/workflows/ci.yml)

Rate limiting middleware for [Hono](https://hono.dev/). Works with Cloudflare Workers, Deno, Bun, and Node.js.

## Installation

```bash
npm install @jfungus/ratelimit-hono
```

## Usage

```ts
import { Hono } from "hono";
import { rateLimiter } from "@jfungus/ratelimit-hono";

const app = new Hono();

// Apply rate limiting to all routes
app.use(
  rateLimiter({
    limit: 100, // 100 requests
    windowMs: 60_000, // per minute
  }),
);

// Or apply to specific routes
app.use("/api/*", rateLimiter({ limit: 50, windowMs: 60_000 }));

app.get("/", (c) => c.text("Hello!"));

export default app;
```

## Options

| Option         | Type                                            | Default            | Description                             |
| -------------- | ----------------------------------------------- | ------------------ | --------------------------------------- |
| `limit`        | `number`                                        | `100`              | Max requests per window                 |
| `windowMs`     | `number`                                        | `60000`            | Window size in milliseconds             |
| `algorithm`    | `"sliding-window"` \| `"fixed-window"`          | `"sliding-window"` | Rate limiting algorithm                 |
| `keyGenerator` | `(c: Context) => string`                        | IP-based           | Function to generate unique key         |
| `skip`         | `(c: Context) => boolean`                       | -                  | Skip rate limiting for certain requests |
| `handler`      | `(c: Context, info: RateLimitInfo) => Response` | 429 JSON           | Custom rate limit exceeded handler      |
| `store`        | `Store`                                         | `MemoryStore`      | Custom storage backend                  |

## Custom Key Generator

```ts
app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    keyGenerator: (c) => {
      // Rate limit by user ID instead of IP
      return c.get("userId") || c.req.header("x-forwarded-for") || "anonymous";
    },
  }),
);
```

## Custom Handler

```ts
app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    handler: (c, info) => {
      return c.json(
        { error: "Too many requests", retryAfter: info.retryAfter },
        429,
      );
    },
  }),
);
```

## Distributed Storage

For multi-instance deployments, use [`@jfungus/ratelimit-unstorage`](https://www.npmjs.com/package/@jfungus/ratelimit-unstorage):

```ts
import { createStorage } from "unstorage";
import redisDriver from "unstorage/drivers/redis";
import { createUnstorageStore } from "@jfungus/ratelimit-unstorage";

const storage = createStorage({
  driver: redisDriver({ url: "redis://localhost:6379" }),
});

app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    store: createUnstorageStore({ storage }),
  }),
);
```

## Documentation

[Full documentation](https://rokasta12.github.io/ratelimit/)

## License

MIT
