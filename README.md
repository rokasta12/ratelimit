# @jf/ratelimit

Multi-framework rate limiting for JavaScript/TypeScript.

[![Documentation](https://img.shields.io/badge/docs-online-blue)](https://rokasta12.github.io/ratelimit/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Multi-Framework** - Works with Hono, Express, H3/Nitro, Nuxt, and more
- **Smart Algorithms** - Fixed window and sliding window (Cloudflare-style)
- **Flexible Storage** - In-memory store included, with unstorage adapter for Redis, KV, etc.
- **TypeScript First** - Full type support with comprehensive type definitions
- **Zero Dependencies** - Core package has no external dependencies

## Documentation

**[Read the full documentation](https://rokasta12.github.io/ratelimit/)**

## Quick Start

### Installation

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

### Usage

#### Hono

```ts
import { Hono } from "hono";
import { rateLimiter } from "@jf/ratelimit-hono";

const app = new Hono();

app.use(
  rateLimiter({
    limit: 100, // 100 requests
    windowMs: 60_000, // per minute
  }),
);

app.get("/", (c) => c.text("Hello!"));
```

#### Express

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
```

#### H3/Nitro

```ts
import { createApp, eventHandler } from "h3";
import { rateLimiter } from "@jf/ratelimit-h3";

const app = createApp();
app.use(rateLimiter({ limit: 100, windowMs: 60_000 }));
```

#### Nuxt

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

## Packages

| Package                   | Description                                  | npm                                                                                                                   |
| ------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `@jf/ratelimit`           | Core library with algorithms and MemoryStore | [![npm](https://img.shields.io/npm/v/@jf/ratelimit)](https://www.npmjs.com/package/@jf/ratelimit)                     |
| `@jf/ratelimit-hono`      | Hono middleware                              | [![npm](https://img.shields.io/npm/v/@jf/ratelimit-hono)](https://www.npmjs.com/package/@jf/ratelimit-hono)           |
| `@jf/ratelimit-express`   | Express middleware                           | [![npm](https://img.shields.io/npm/v/@jf/ratelimit-express)](https://www.npmjs.com/package/@jf/ratelimit-express)     |
| `@jf/ratelimit-h3`        | H3/Nitro middleware                          | [![npm](https://img.shields.io/npm/v/@jf/ratelimit-h3)](https://www.npmjs.com/package/@jf/ratelimit-h3)               |
| `@jf/ratelimit-nuxt`      | Nuxt module                                  | [![npm](https://img.shields.io/npm/v/@jf/ratelimit-nuxt)](https://www.npmjs.com/package/@jf/ratelimit-nuxt)           |
| `@jf/ratelimit-unstorage` | unstorage adapter                            | [![npm](https://img.shields.io/npm/v/@jf/ratelimit-unstorage)](https://www.npmjs.com/package/@jf/ratelimit-unstorage) |

## Algorithms

### Fixed Window

Simple counter that resets at fixed time intervals.

```ts
rateLimiter({ algorithm: "fixed-window", limit: 100, windowMs: 60_000 });
```

### Sliding Window (default)

Cloudflare-style weighted sliding window for smoother rate limiting.

```ts
rateLimiter({ algorithm: "sliding-window", limit: 100, windowMs: 60_000 });
```

The sliding window algorithm considers requests from the previous window, weighted by how far we are into the current window:

```
estimatedCount = floor(previousCount × weight) + currentCount
weight = (windowMs - elapsedMs) / windowMs
```

## Storage

### MemoryStore (default)

Built-in memory store for single-instance deployments:

```ts
import { MemoryStore } from "@jf/ratelimit";

const store = new MemoryStore();
store.init(60_000);
```

### Distributed Storage

Use `@jf/ratelimit-unstorage` for Redis, Cloudflare KV, and more:

```ts
import { createStorage } from "unstorage";
import redisDriver from "unstorage/drivers/redis";
import { createUnstorageStore } from "@jf/ratelimit-unstorage";

const storage = createStorage({
  driver: redisDriver({ url: "redis://localhost:6379" }),
});

const store = createUnstorageStore({ storage });
```

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT
