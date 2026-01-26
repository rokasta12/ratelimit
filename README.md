# @jfungus/ratelimit

Multi-framework rate limiting for JavaScript/TypeScript.

[![CI](https://github.com/rokasta12/ratelimit/actions/workflows/ci.yml/badge.svg)](https://github.com/rokasta12/ratelimit/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@jfungus/ratelimit)](https://www.npmjs.com/package/@jfungus/ratelimit)
[![npm downloads](https://img.shields.io/npm/dm/@jfungus/ratelimit)](https://www.npmjs.com/package/@jfungus/ratelimit)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@jfungus/ratelimit)](https://bundlephobia.com/package/@jfungus/ratelimit)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<p align="center">
  <a href="https://rokasta12.github.io/ratelimit/">Documentation</a>
</p>

## Features

- **Multi-Framework** - Works with Hono, Express, H3/Nitro, Nuxt
- **Smart Algorithms** - Fixed window and sliding window (Cloudflare-style)
- **Flexible Storage** - Memory, Redis, Cloudflare KV, Vercel KV, and more
- **TypeScript First** - Full type support with comprehensive definitions
- **Zero Dependencies** - Core package has no external dependencies

## Quick Start

### 1. Install

```bash
# For Hono
npm install @jfungus/ratelimit-hono

# For Express
npm install @jfungus/ratelimit-express

# For H3/Nitro
npm install @jfungus/ratelimit-h3

# For Nuxt
npm install @jfungus/ratelimit-nuxt
```

### 2. Use

```ts
import { Hono } from "hono";
import { rateLimiter } from "@jfungus/ratelimit-hono";

const app = new Hono();

app.use(
  rateLimiter({
    limit: 100, // 100 requests
    windowMs: 60_000, // per minute
  }),
);

app.get("/", (c) => c.text("Hello!"));
```

That's it! Your API is now rate limited.

## Options

| Option         | Type       | Default            | Description                             |
| -------------- | ---------- | ------------------ | --------------------------------------- |
| `limit`        | `number`   | `100`              | Max requests per window                 |
| `windowMs`     | `number`   | `60000`            | Window size in milliseconds             |
| `algorithm`    | `string`   | `"sliding-window"` | `"sliding-window"` or `"fixed-window"`  |
| `keyGenerator` | `function` | IP-based           | Function to identify clients            |
| `skip`         | `function` | -                  | Skip rate limiting for certain requests |
| `handler`      | `function` | 429 response       | Custom rate limit exceeded handler      |
| `store`        | `Store`    | `MemoryStore`      | Custom storage backend                  |

[See all options in documentation](https://rokasta12.github.io/ratelimit/)

## Packages

| Package                                                                                      | Description                                  |
| -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [`@jfungus/ratelimit`](https://www.npmjs.com/package/@jfungus/ratelimit)                     | Core library with algorithms and MemoryStore |
| [`@jfungus/ratelimit-hono`](https://www.npmjs.com/package/@jfungus/ratelimit-hono)           | Hono middleware                              |
| [`@jfungus/ratelimit-express`](https://www.npmjs.com/package/@jfungus/ratelimit-express)     | Express middleware                           |
| [`@jfungus/ratelimit-h3`](https://www.npmjs.com/package/@jfungus/ratelimit-h3)               | H3/Nitro middleware                          |
| [`@jfungus/ratelimit-nuxt`](https://www.npmjs.com/package/@jfungus/ratelimit-nuxt)           | Nuxt module                                  |
| [`@jfungus/ratelimit-unstorage`](https://www.npmjs.com/package/@jfungus/ratelimit-unstorage) | Adapter for Redis, Cloudflare KV, etc.       |

## Examples

### Express

```ts
import express from "express";
import { rateLimiter } from "@jfungus/ratelimit-express";

const app = express();
app.use(rateLimiter({ limit: 100, windowMs: 60_000 }));
```

### H3/Nitro

```ts
import { createApp } from "h3";
import { rateLimiter } from "@jfungus/ratelimit-h3";

const app = createApp();
app.use(rateLimiter({ limit: 100, windowMs: 60_000 }));
```

### Nuxt

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@jfungus/ratelimit-nuxt"],
  rateLimit: {
    limit: 100,
    windowMs: 60_000,
  },
});
```

### Custom Key Generator

```ts
app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    keyGenerator: (c) => c.req.header("X-API-Key") ?? "anonymous",
  }),
);
```

### Distributed Storage (Redis)

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

## Algorithms

### Sliding Window (default)

Cloudflare-style weighted sliding window for smoother rate limiting:

```ts
rateLimiter({ algorithm: "sliding-window", limit: 100, windowMs: 60_000 });
```

### Fixed Window

Simple counter that resets at fixed intervals:

```ts
rateLimiter({ algorithm: "fixed-window", limit: 100, windowMs: 60_000 });
```

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT
