# @jfungus/ratelimit

[![npm version](https://img.shields.io/npm/v/@jfungus/ratelimit)](https://www.npmjs.com/package/@jfungus/ratelimit)
[![npm downloads](https://img.shields.io/npm/dm/@jfungus/ratelimit)](https://www.npmjs.com/package/@jfungus/ratelimit)
[![CI](https://github.com/rokasta12/ratelimit/actions/workflows/ci.yml/badge.svg)](https://github.com/rokasta12/ratelimit/actions/workflows/ci.yml)

Framework-agnostic rate limiting library with sliding window algorithm. Zero dependencies.

## Installation

```bash
npm install @jfungus/ratelimit
```

## Usage

```ts
import { RateLimiter, MemoryStore } from "@jfungus/ratelimit";

const store = new MemoryStore();
store.init(60 * 1000); // 1 minute window

const limiter = new RateLimiter({
  limit: 100,
  windowMs: 60 * 1000, // 1 minute
  store,
});

// Check rate limit
const result = await limiter.check("user-123");

if (!result.allowed) {
  console.log(`Rate limited. Retry after ${result.retryAfter}ms`);
}
```

## Algorithms

### Sliding Window (default)

Cloudflare-style weighted sliding window for smoother rate limiting:

```ts
const limiter = new RateLimiter({
  algorithm: "sliding-window",
  limit: 100,
  windowMs: 60 * 1000, // 1 minute
  store,
});
```

### Fixed Window

Simple counter that resets at fixed intervals:

```ts
const limiter = new RateLimiter({
  algorithm: "fixed-window",
  limit: 100,
  windowMs: 60 * 1000, // 1 minute
  store,
});
```

## Framework Middleware

For framework-specific middleware, see:

- [`@jfungus/ratelimit-hono`](https://www.npmjs.com/package/@jfungus/ratelimit-hono) - Hono
- [`@jfungus/ratelimit-express`](https://www.npmjs.com/package/@jfungus/ratelimit-express) - Express
- [`@jfungus/ratelimit-h3`](https://www.npmjs.com/package/@jfungus/ratelimit-h3) - H3/Nitro
- [`@jfungus/ratelimit-nuxt`](https://www.npmjs.com/package/@jfungus/ratelimit-nuxt) - Nuxt

## Documentation

[Full documentation](https://rokasta12.github.io/ratelimit/)

## License

MIT
