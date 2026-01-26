# @jfungus/ratelimit-express

[![npm version](https://img.shields.io/npm/v/@jfungus/ratelimit-express)](https://www.npmjs.com/package/@jfungus/ratelimit-express)
[![npm downloads](https://img.shields.io/npm/dm/@jfungus/ratelimit-express)](https://www.npmjs.com/package/@jfungus/ratelimit-express)
[![CI](https://github.com/rokasta12/ratelimit/actions/workflows/ci.yml/badge.svg)](https://github.com/rokasta12/ratelimit/actions/workflows/ci.yml)

Rate limiting middleware for [Express](https://expressjs.com/).

## Installation

```bash
npm install @jfungus/ratelimit-express
```

## Usage

```ts
import express from "express";
import { rateLimiter } from "@jfungus/ratelimit-express";

const app = express();

// Apply rate limiting to all routes
app.use(
  rateLimiter({
    limit: 100, // 100 requests
    windowMs: 60_000, // per minute
  }),
);

// Or apply to specific routes
app.use("/api", rateLimiter({ limit: 50, windowMs: 60_000 }));

app.get("/", (req, res) => {
  res.send("Hello!");
});

app.listen(3000);
```

## Options

| Option                   | Type                                   | Default            | Description                             |
| ------------------------ | -------------------------------------- | ------------------ | --------------------------------------- |
| `limit`                  | `number`                               | `100`              | Max requests per window                 |
| `windowMs`               | `number`                               | `60000`            | Window size in milliseconds             |
| `algorithm`              | `"sliding-window"` \| `"fixed-window"` | `"sliding-window"` | Rate limiting algorithm                 |
| `keyGenerator`           | `(req: Request) => string`             | IP-based           | Function to generate unique key         |
| `skip`                   | `(req: Request) => boolean`            | -                  | Skip rate limiting for certain requests |
| `handler`                | `(req, res, info) => void`             | 429 JSON           | Custom rate limit exceeded handler      |
| `store`                  | `Store`                                | `MemoryStore`      | Custom storage backend                  |
| `skipSuccessfulRequests` | `boolean`                              | `false`            | Don't count successful requests         |
| `skipFailedRequests`     | `boolean`                              | `false`            | Don't count failed requests             |

## Custom Key Generator

```ts
app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    keyGenerator: (req) => {
      // Rate limit by user ID instead of IP
      return req.user?.id || req.ip || "anonymous";
    },
  }),
);
```

## Skip Options

```ts
app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    // Don't count successful requests (2xx) against the limit
    skipSuccessfulRequests: true,
    // Or skip specific requests entirely
    skip: (req) => req.path === "/health",
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
