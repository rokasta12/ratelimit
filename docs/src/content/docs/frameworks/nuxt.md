---
title: Nuxt
description: Rate limiting for Nuxt applications
---

## Installation

```bash
npm install @jf/ratelimit-nuxt
```

## Basic Usage

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

That's it! Rate limiting is now applied to all server routes.

## Options

| Option      | Type                                 | Default                          | Description                  |
| ----------- | ------------------------------------ | -------------------------------- | ---------------------------- |
| `enabled`   | `boolean`                            | `true`                           | Enable rate limiting         |
| `limit`     | `number`                             | `100`                            | Max requests per window      |
| `windowMs`  | `number`                             | `60000`                          | Window duration in ms        |
| `algorithm` | `'fixed-window' \| 'sliding-window'` | `'sliding-window'`               | Algorithm                    |
| `storage`   | `string`                             | `'memory'`                       | Storage driver key           |
| `skip`      | `string[]`                           | `['/_nuxt/**', '/__nuxt_error']` | Routes to skip               |
| `include`   | `string[]`                           | -                                | Only rate limit these routes |

## API Routes Only

```ts
export default defineNuxtConfig({
  modules: ["@jf/ratelimit-nuxt"],
  rateLimit: {
    include: ["/api/**"],
    limit: 100,
    windowMs: 60_000,
  },
});
```

## With Redis

```ts
export default defineNuxtConfig({
  modules: ["@jf/ratelimit-nuxt"],
  rateLimit: {
    storage: "redis",
  },
  nitro: {
    storage: {
      redis: {
        driver: "redis",
        url: process.env.REDIS_URL,
      },
    },
  },
});
```

## Access Rate Limit Info

```ts
// server/api/data.ts
export default defineEventHandler((event) => {
  const info = event.context.rateLimit;
  // { limit: 100, remaining: 99, reset: 1234567890 }

  return { data: "hello" };
});
```

## Disable for Development

```ts
export default defineNuxtConfig({
  modules: ["@jf/ratelimit-nuxt"],
  rateLimit: {
    enabled: process.env.NODE_ENV === "production",
  },
});
```
