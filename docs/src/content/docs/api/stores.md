---
title: Stores API
description: API reference for rate limit stores
---

## @jf/ratelimit-unstorage

Adapter for using [unstorage](https://unstorage.unjs.io/) backends with rate limiting.

### Installation

```bash
npm install @jf/ratelimit-unstorage unstorage
```

### createUnstorageStore

Create a rate limit store from an unstorage instance.

```ts
import { createStorage } from "unstorage";
import { createUnstorageStore } from "@jf/ratelimit-unstorage";

const storage = createStorage();
const store = createUnstorageStore({ storage });
```

**Options:**

| Option    | Type      | Default        | Description        |
| --------- | --------- | -------------- | ------------------ |
| `storage` | `Storage` | Required       | unstorage instance |
| `prefix`  | `string`  | `'ratelimit:'` | Key prefix         |

**Returns:** `RateLimitStore`

### createNuxtStore

Helper for Nuxt applications using `useStorage()`.

```ts
import { createNuxtStore } from "@jf/ratelimit-unstorage";

// In a Nuxt server route or middleware
const store = createNuxtStore(useStorage());

// With custom prefix
const store = createNuxtStore(useStorage(), "my-app:ratelimit:");
```

**Parameters:**

| Parameter | Type      | Description                                   |
| --------- | --------- | --------------------------------------------- |
| `storage` | `Storage` | Nuxt storage instance                         |
| `prefix`  | `string`  | Optional key prefix (default: `'ratelimit:'`) |

**Returns:** `RateLimitStore`

## Store Interface

All stores implement the `RateLimitStore` interface from `@jf/ratelimit`:

```ts
import type { RateLimitStore, StoreResult } from "@jf/ratelimit";
```

### Required Methods

#### increment

Atomically increment the counter for a key and return the new state.

```ts
increment(key: string): StoreResult | Promise<StoreResult>
```

**Important:** This should be atomic - increment and return should happen as a single operation to prevent race conditions.

#### resetKey

Reset (delete) a specific key.

```ts
resetKey(key: string): void | Promise<void>
```

### Optional Methods

#### init

Initialize the store. Called once before first use.

```ts
init?(windowMs: number): void | Promise<void>
```

#### get

Get the current state for a key. Required for sliding window algorithm.

```ts
get?(key: string): StoreResult | undefined | Promise<StoreResult | undefined>
```

#### decrement

Decrement the counter. Used for `skipSuccessfulRequests` / `skipFailedRequests`.

```ts
decrement?(key: string): void | Promise<void>
```

#### resetAll

Reset all keys. Useful for testing or administrative purposes.

```ts
resetAll?(): void | Promise<void>
```

#### shutdown

Clean up resources (timers, connections, etc.).

```ts
shutdown?(): void | Promise<void>
```

## Example: Custom Redis Store

```ts
import type { RateLimitStore, StoreResult } from "@jf/ratelimit";
import { createClient } from "redis";

export function createRedisStore(url: string): RateLimitStore {
  const client = createClient({ url });
  let windowMs = 60_000;

  return {
    async init(ms: number) {
      windowMs = ms;
      await client.connect();
    },

    async increment(key: string): Promise<StoreResult> {
      const now = Date.now();
      const reset = now + windowMs;
      const ttl = Math.ceil(windowMs / 1000);

      // Atomic increment with expiry
      const count = await client.incr(key);
      if (count === 1) {
        await client.expire(key, ttl);
      }

      return { count, reset };
    },

    async get(key: string): Promise<StoreResult | undefined> {
      const count = await client.get(key);
      if (!count) return undefined;

      const ttl = await client.ttl(key);
      const reset = Date.now() + ttl * 1000;

      return { count: parseInt(count, 10), reset };
    },

    async decrement(key: string) {
      await client.decr(key);
    },

    async resetKey(key: string) {
      await client.del(key);
    },

    async resetAll() {
      const keys = await client.keys("*");
      if (keys.length > 0) {
        await client.del(keys);
      }
    },

    async shutdown() {
      await client.quit();
    },
  };
}
```

## Storage Drivers

The unstorage adapter works with any unstorage driver:

### Memory (default)

```ts
import { createStorage } from "unstorage";
const storage = createStorage(); // Memory by default
```

### Redis

```ts
import { createStorage } from "unstorage";
import redisDriver from "unstorage/drivers/redis";

const storage = createStorage({
  driver: redisDriver({ url: "redis://localhost:6379" }),
});
```

### Cloudflare KV

```ts
import { createStorage } from "unstorage";
import cloudflareKVBindingDriver from "unstorage/drivers/cloudflare-kv-binding";

const storage = createStorage({
  driver: cloudflareKVBindingDriver({ binding: "RATE_LIMIT_KV" }),
});
```

### Vercel KV

```ts
import { createStorage } from "unstorage";
import vercelKVDriver from "unstorage/drivers/vercel-kv";

const storage = createStorage({
  driver: vercelKVDriver(),
});
```

See [unstorage drivers](https://unstorage.unjs.io/drivers) for all available options.
