# @jfungus/ratelimit-unstorage

[![npm version](https://img.shields.io/npm/v/@jfungus/ratelimit-unstorage)](https://www.npmjs.com/package/@jfungus/ratelimit-unstorage)
[![npm downloads](https://img.shields.io/npm/dm/@jfungus/ratelimit-unstorage)](https://www.npmjs.com/package/@jfungus/ratelimit-unstorage)
[![CI](https://github.com/rokasta12/ratelimit/actions/workflows/ci.yml/badge.svg)](https://github.com/rokasta12/ratelimit/actions/workflows/ci.yml)

[unstorage](https://unstorage.unjs.io/) adapter for `@jfungus/ratelimit`. Enables distributed rate limiting with Redis, Cloudflare KV, Vercel KV, Upstash, and more.

## Installation

```bash
npm install @jfungus/ratelimit-unstorage unstorage
```

## Usage

```ts
import { createStorage } from "unstorage";
import { createUnstorageStore } from "@jfungus/ratelimit-unstorage";
import { rateLimiter } from "@jfungus/ratelimit-hono"; // or express, h3

// Create unstorage instance with your preferred driver
const storage = createStorage({
  driver: /* your driver */,
});

// Create the store
const store = createUnstorageStore({ storage });

// Use with any middleware
app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    store,
  })
);
```

## Storage Drivers

### Redis

```ts
import { createStorage } from "unstorage";
import redisDriver from "unstorage/drivers/redis";
import { createUnstorageStore } from "@jfungus/ratelimit-unstorage";

const storage = createStorage({
  driver: redisDriver({
    url: "redis://localhost:6379",
    // or with options
    host: "localhost",
    port: 6379,
    password: "your-password",
    db: 0,
  }),
});

const store = createUnstorageStore({ storage });
```

### Upstash Redis

```ts
import { createStorage } from "unstorage";
import upstashDriver from "unstorage/drivers/upstash";
import { createUnstorageStore } from "@jfungus/ratelimit-unstorage";

const storage = createStorage({
  driver: upstashDriver({
    url: "https://your-upstash-url.upstash.io",
    token: "your-upstash-token",
  }),
});

const store = createUnstorageStore({ storage });
```

### Cloudflare KV

```ts
import { createStorage } from "unstorage";
import cloudflareKVDriver from "unstorage/drivers/cloudflare-kv-binding";
import { createUnstorageStore } from "@jfungus/ratelimit-unstorage";

const storage = createStorage({
  driver: cloudflareKVDriver({
    binding: "RATELIMIT_KV",
  }),
});

const store = createUnstorageStore({ storage });
```

### Vercel KV

```ts
import { createStorage } from "unstorage";
import vercelKVDriver from "unstorage/drivers/vercel-kv";
import { createUnstorageStore } from "@jfungus/ratelimit-unstorage";

const storage = createStorage({
  driver: vercelKVDriver({
    // Uses VERCEL_KV_* env vars automatically
  }),
});

const store = createUnstorageStore({ storage });
```

### Memory (for development)

```ts
import { createStorage } from "unstorage";
import { createUnstorageStore } from "@jfungus/ratelimit-unstorage";

const storage = createStorage(); // memory driver is default

const store = createUnstorageStore({ storage });
```

## Options

```ts
const store = createUnstorageStore({
  // Required: unstorage instance
  storage,

  // Optional: key prefix (default: "ratelimit")
  prefix: "ratelimit",
});
```

## Supported Drivers

Any [unstorage driver](https://unstorage.unjs.io/drivers) that supports `getItem`, `setItem`, and basic operations:

- Redis
- Upstash
- Cloudflare KV
- Vercel KV
- Deno KV
- Azure Storage
- MongoDB
- Planetscale
- And many more...

## Documentation

[Full documentation](https://rokasta12.github.io/ratelimit/)

## License

MIT
