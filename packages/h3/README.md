# @jfungus/ratelimit-h3

[![npm version](https://img.shields.io/npm/v/@jfungus/ratelimit-h3)](https://www.npmjs.com/package/@jfungus/ratelimit-h3)
[![npm downloads](https://img.shields.io/npm/dm/@jfungus/ratelimit-h3)](https://www.npmjs.com/package/@jfungus/ratelimit-h3)
[![CI](https://github.com/rokasta12/ratelimit/actions/workflows/ci.yml/badge.svg)](https://github.com/rokasta12/ratelimit/actions/workflows/ci.yml)

Rate limiting middleware for [H3](https://h3.unjs.io/) and [Nitro](https://nitro.unjs.io/).

## Installation

```bash
npm install @jfungus/ratelimit-h3
```

## Usage

### H3

```ts
import { createApp, createRouter, eventHandler } from "h3";
import { rateLimiter } from "@jfungus/ratelimit-h3";

const app = createApp();

// Apply rate limiting globally
app.use(rateLimiter({ limit: 100, windowMs: 60_000 }));

const router = createRouter();
router.get(
  "/",
  eventHandler(() => "Hello!"),
);

app.use(router);
```

### Nitro

```ts
// server/middleware/ratelimit.ts
import { rateLimiter } from "@jfungus/ratelimit-h3";

export default rateLimiter({
  limit: 100,
  windowMs: 60_000,
});
```

## Options

| Option         | Type                                            | Default            | Description                             |
| -------------- | ----------------------------------------------- | ------------------ | --------------------------------------- |
| `limit`        | `number`                                        | `100`              | Max requests per window                 |
| `windowMs`     | `number`                                        | `60000`            | Window size in milliseconds             |
| `algorithm`    | `"sliding-window"` \| `"fixed-window"`          | `"sliding-window"` | Rate limiting algorithm                 |
| `keyGenerator` | `(event: H3Event) => string`                    | IP-based           | Function to generate unique key         |
| `skip`         | `(event: H3Event) => boolean`                   | -                  | Skip rate limiting for certain requests |
| `handler`      | `(event: H3Event, info: RateLimitInfo) => void` | 429 JSON           | Custom rate limit exceeded handler      |
| `store`        | `Store`                                         | `MemoryStore`      | Custom storage backend                  |

## Custom Key Generator

```ts
import { getHeader } from "h3";

app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    keyGenerator: (event) => {
      // Rate limit by API key
      return getHeader(event, "x-api-key") || "anonymous";
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

## Nuxt

For Nuxt applications, use the dedicated module [`@jfungus/ratelimit-nuxt`](https://www.npmjs.com/package/@jfungus/ratelimit-nuxt) instead.

## Documentation

[Full documentation](https://rokasta12.github.io/ratelimit/)

## License

MIT
