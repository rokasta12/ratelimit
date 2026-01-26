---
title: Stores
description: Storage backends for rate limiting state
---

## Overview

Rate limiters need to track request counts somewhere. `@jf/ratelimit` uses a **store** interface that can be implemented for any storage backend.

## Built-in: MemoryStore

The `MemoryStore` is included in the core package and is the default store for all framework adapters.

```ts
import { MemoryStore } from "@jf/ratelimit";

const store = new MemoryStore();
store.init(60_000); // Window duration in ms

// Use with any framework adapter
rateLimiter({
  limit: 100,
  windowMs: 60_000,
  store,
});
```

### Features

- Zero dependencies
- Automatic cleanup of expired entries
- Full algorithm support (including `get()` for sliding window)
- Suitable for single-instance deployments

### Limitations

- Data is lost on restart
- Not shared between instances (not suitable for multi-instance/clustered deployments)

## Unstorage Adapter

For distributed deployments, use `@jf/ratelimit-unstorage` which wraps [unstorage](https://unstorage.unjs.io/) - a universal storage library.

```bash
npm install @jf/ratelimit-unstorage unstorage
```

### Basic Usage

```ts
import { createStorage } from "unstorage";
import { createUnstorageStore } from "@jf/ratelimit-unstorage";

const storage = createStorage();
const store = createUnstorageStore({ storage });

rateLimiter({
  limit: 100,
  windowMs: 60_000,
  store,
});
```

### Redis

```ts
import { createStorage } from "unstorage";
import redisDriver from "unstorage/drivers/redis";
import { createUnstorageStore } from "@jf/ratelimit-unstorage";

const storage = createStorage({
  driver: redisDriver({
    url: "redis://localhost:6379",
  }),
});

const store = createUnstorageStore({ storage });
```

### Cloudflare KV

```ts
import { createStorage } from "unstorage";
import cloudflareKVBindingDriver from "unstorage/drivers/cloudflare-kv-binding";
import { createUnstorageStore } from "@jf/ratelimit-unstorage";

const storage = createStorage({
  driver: cloudflareKVBindingDriver({
    binding: "RATE_LIMIT_KV", // Your KV binding name
  }),
});

const store = createUnstorageStore({ storage });
```

### Nuxt with useStorage()

For Nuxt applications, use the `createNuxtStore` helper:

```ts
// server/middleware/ratelimit.ts
import { createNuxtStore } from "@jf/ratelimit-unstorage";
import { rateLimiter } from "@jf/ratelimit-h3";

export default rateLimiter({
  limit: 100,
  windowMs: 60_000,
  store: createNuxtStore(useStorage()),
});
```

### Custom Prefix

```ts
const store = createUnstorageStore({
  storage,
  prefix: "my-app:ratelimit:", // Default: 'ratelimit:'
});
```

## Custom Store

Implement the `RateLimitStore` interface for any storage backend:

```ts
import type { RateLimitStore, StoreResult } from "@jf/ratelimit";

const customStore: RateLimitStore = {
  // Required: Initialize (called once)
  init(windowMs: number): void {
    // Setup your storage
  },

  // Required: Increment and return current state
  increment(key: string): StoreResult | Promise<StoreResult> {
    // Atomically increment and return { count, reset }
    return { count: 1, reset: Date.now() + 60_000 };
  },

  // Required: Reset a key
  resetKey(key: string): void | Promise<void> {
    // Delete the key
  },

  // Optional but recommended: Get current state
  get(key: string): StoreResult | undefined | Promise<StoreResult | undefined> {
    // Return current state or undefined if not exists
    return undefined;
  },

  // Optional: Decrement (for skipSuccessfulRequests)
  decrement(key: string): void | Promise<void> {
    // Decrement counter
  },

  // Optional: Reset all keys
  resetAll(): void | Promise<void> {
    // Clear all rate limit data
  },

  // Optional: Cleanup
  shutdown(): void | Promise<void> {
    // Close connections, clear timers
  },
};
```

### StoreResult Type

```ts
type StoreResult = {
  count: number; // Current request count in window
  reset: number; // Unix timestamp (ms) when window resets
};
```

## Store Selection Guide

| Deployment         | Recommended Store          |
| ------------------ | -------------------------- |
| Single instance    | `MemoryStore` (default)    |
| Multiple instances | unstorage + Redis          |
| Cloudflare Workers | unstorage + Cloudflare KV  |
| Nuxt (development) | `MemoryStore`              |
| Nuxt (production)  | unstorage + `useStorage()` |
| Serverless         | unstorage + Redis/KV       |
