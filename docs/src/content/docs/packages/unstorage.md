---
title: "@jf/ratelimit-unstorage"
description: "Distributed storage adapter for rate limiting. Connect to Redis, Cloudflare KV, Vercel KV, and 20+ storage backends."
---

Storage adapter using [unstorage](https://unstorage.unjs.io/) - connect to Redis, Cloudflare KV, Vercel KV, and many more backends.

## Installation

```bash
npm install @jf/ratelimit-unstorage unstorage
```

## When to Use

- **Multiple server instances** - Share rate limit state across servers
- **Serverless** - Persist state between cold starts
- **Edge deployments** - Use Cloudflare KV, Vercel KV, etc.

For single-instance deployments, the built-in `MemoryStore` is simpler and faster.

## Basic Usage

```ts
import { createStorage } from "unstorage";
import { createUnstorageStore } from "@jf/ratelimit-unstorage";

const storage = createStorage(); // Memory by default
const store = createUnstorageStore({ storage });

// Use with any framework adapter
rateLimiter({ limit: 100, windowMs: 60_000, store });
```

## Redis

```ts
import { createStorage } from "unstorage";
import redisDriver from "unstorage/drivers/redis";
import { createUnstorageStore } from "@jf/ratelimit-unstorage";

const storage = createStorage({
  driver: redisDriver({
    url: process.env.REDIS_URL, // redis://localhost:6379
  }),
});

const store = createUnstorageStore({ storage });
```

## Cloudflare KV

```ts
import { createStorage } from "unstorage";
import cloudflareKVBindingDriver from "unstorage/drivers/cloudflare-kv-binding";
import { createUnstorageStore } from "@jf/ratelimit-unstorage";

const storage = createStorage({
  driver: cloudflareKVBindingDriver({
    binding: "RATE_LIMIT_KV",
  }),
});

const store = createUnstorageStore({ storage });
```

## Vercel KV

```ts
import { createStorage } from "unstorage";
import vercelKVDriver from "unstorage/drivers/vercel-kv";
import { createUnstorageStore } from "@jf/ratelimit-unstorage";

const storage = createStorage({
  driver: vercelKVDriver(),
});

const store = createUnstorageStore({ storage });
```

## Options

| Option    | Type      | Default        | Description        |
| --------- | --------- | -------------- | ------------------ |
| `storage` | `Storage` | Required       | unstorage instance |
| `prefix`  | `string`  | `'ratelimit:'` | Key prefix         |

```ts
const store = createUnstorageStore({
  storage,
  prefix: "myapp:ratelimit:", // Custom prefix
});
```

## Nuxt Helper

For Nuxt applications using `useStorage()`:

```ts
import { createNuxtStore } from "@jf/ratelimit-unstorage";

// In a Nuxt server route or middleware
const store = createNuxtStore(useStorage());

// With custom prefix
const store = createNuxtStore(useStorage(), "myapp:ratelimit:");
```

## Supported Drivers

Any [unstorage driver](https://unstorage.unjs.io/drivers) works:

- Redis
- Cloudflare KV
- Vercel KV
- MongoDB
- Planetscale
- Upstash
- Memory
- Filesystem
- And many more...

## Related

- [unstorage Documentation](https://unstorage.unjs.io/)
- [Stores](/ratelimit/concepts/stores/) - Store interface details
- [@jf/ratelimit](/ratelimit/packages/core/) - Core library
