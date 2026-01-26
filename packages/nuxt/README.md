# @jfungus/ratelimit-nuxt

[![npm version](https://img.shields.io/npm/v/@jfungus/ratelimit-nuxt)](https://www.npmjs.com/package/@jfungus/ratelimit-nuxt)
[![npm downloads](https://img.shields.io/npm/dm/@jfungus/ratelimit-nuxt)](https://www.npmjs.com/package/@jfungus/ratelimit-nuxt)
[![CI](https://github.com/rokasta12/ratelimit/actions/workflows/ci.yml/badge.svg)](https://github.com/rokasta12/ratelimit/actions/workflows/ci.yml)

Rate limiting module for [Nuxt 3](https://nuxt.com/). Automatically integrates with Nuxt's `useStorage()` for distributed deployments.

## Installation

```bash
npm install @jfungus/ratelimit-nuxt
```

## Usage

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@jfungus/ratelimit-nuxt"],
  rateLimit: {
    limit: 100, // 100 requests
    windowMs: 60 * 1000, // 1 minute
  },
});
```

That's it! Rate limiting is automatically applied to all server routes.

## Options

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@jfungus/ratelimit-nuxt"],
  rateLimit: {
    // Enable/disable the module
    enabled: true,

    // Max requests per window
    limit: 100,

    // Window size in milliseconds
    windowMs: 60 * 1000, // 1 minute

    // Rate limiting algorithm
    algorithm: "sliding-window", // or "fixed-window"

    // Routes to apply rate limiting (default: all API routes)
    routes: ["/api/**"],

    // Storage key prefix
    storageKey: "ratelimit",

    // Response status code when rate limited
    statusCode: 429,

    // Response message when rate limited
    message: "Too Many Requests",
  },
});
```

## How It Works

This module:

1. Registers a Nitro plugin that adds rate limiting middleware
2. Uses Nuxt's built-in `useStorage()` for storing rate limit data
3. Automatically works with any storage driver configured in your Nuxt app

## Distributed Storage

Nuxt's `useStorage()` supports multiple backends. Configure your preferred storage in `nuxt.config.ts`:

### Redis

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@jfungus/ratelimit-nuxt"],
  rateLimit: {
    limit: 100,
    windowMs: 60 * 1000, // 1 minute
  },
  nitro: {
    storage: {
      ratelimit: {
        driver: "redis",
        url: "redis://localhost:6379",
      },
    },
  },
});
```

### Vercel KV

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@jfungus/ratelimit-nuxt"],
  rateLimit: {
    limit: 100,
    windowMs: 60 * 1000, // 1 minute
  },
  nitro: {
    storage: {
      ratelimit: {
        driver: "vercelKV",
      },
    },
  },
});
```

### Cloudflare KV

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@jfungus/ratelimit-nuxt"],
  rateLimit: {
    limit: 100,
    windowMs: 60 * 1000, // 1 minute
  },
  nitro: {
    storage: {
      ratelimit: {
        driver: "cloudflareKVBinding",
        binding: "RATELIMIT_KV",
      },
    },
  },
});
```

## Documentation

[Full documentation](https://rokasta12.github.io/ratelimit/)

## License

MIT
