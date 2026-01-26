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

Configure in `nuxt.config.ts` under `rateLimit`:

| Option         | Type                                 | Default                          | Description                  |
| -------------- | ------------------------------------ | -------------------------------- | ---------------------------- |
| `enabled`      | `boolean`                            | `true`                           | Enable rate limiting         |
| `limit`        | `number`                             | `100`                            | Max requests per window      |
| `windowMs`     | `number`                             | `60000`                          | Window duration in ms        |
| `algorithm`    | `'fixed-window' \| 'sliding-window'` | `'sliding-window'`               | Algorithm                    |
| `storage`      | `string`                             | `'memory'`                       | Storage driver key           |
| `skip`         | `string[]`                           | `['/_nuxt/**', '/__nuxt_error']` | Routes to skip               |
| `include`      | `string[]`                           | -                                | Only rate limit these routes |
| `statusCode`   | `number`                             | `429`                            | Response status code         |
| `message`      | `string`                             | `'Too Many Requests'`            | Response message             |
| `headers`      | `boolean`                            | `true`                           | Include rate limit headers   |
| `keyGenerator` | `'ip' \| 'ip-ua'`                    | `'ip'`                           | Key generation strategy      |
| `dryRun`       | `boolean`                            | `false`                          | Log but don't block          |

## Configuration Examples

### API Routes Only

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

### Skip Certain Routes

```ts
export default defineNuxtConfig({
  modules: ["@jf/ratelimit-nuxt"],
  rateLimit: {
    skip: ["/_nuxt/**", "/__nuxt_error", "/api/health", "/api/public/**"],
  },
});
```

### Stricter Limits

```ts
export default defineNuxtConfig({
  modules: ["@jf/ratelimit-nuxt"],
  rateLimit: {
    limit: 30,
    windowMs: 60_000,
    algorithm: "sliding-window",
  },
});
```

## Distributed Storage

For production deployments with multiple instances, use a shared storage backend.

### With Redis

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@jf/ratelimit-nuxt"],
  rateLimit: {
    storage: "redis", // Uses Nuxt's storage layer
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

### With Cloudflare KV

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@jf/ratelimit-nuxt"],
  rateLimit: {
    storage: "cloudflare",
  },
  nitro: {
    storage: {
      cloudflare: {
        driver: "cloudflare-kv-binding",
        binding: "RATE_LIMIT_KV",
      },
    },
  },
});
```

## Access Rate Limit Info

In server routes:

```ts
// server/api/data.ts
export default defineEventHandler((event) => {
  const info = event.context.rateLimit;
  // { limit: 100, remaining: 99, reset: 1234567890 }

  return { data: "hello" };
});
```

## Custom Middleware

For more control, use `@jf/ratelimit-h3` directly:

```ts
// server/middleware/custom-ratelimit.ts
import { rateLimiter } from "@jf/ratelimit-h3";
import { createUnstorageStore } from "@jf/ratelimit-unstorage";

export default rateLimiter({
  limit: async (event) => {
    // Dynamic limits based on user
    const user = await getUserFromEvent(event);
    return user?.isPremium ? 1000 : 100;
  },
  windowMs: 60_000,
  store: createUnstorageStore({ storage: useStorage() }),
  keyGenerator: (event) => {
    return getHeader(event, "x-user-id") ?? getRequestIP(event) ?? "unknown";
  },
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
