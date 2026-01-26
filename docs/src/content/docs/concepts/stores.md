---
title: Stores
description: Storage backends for rate limiting state
---

## Overview

Rate limiters need to track request counts. `@jfungus/ratelimit` uses a **store** interface that can be implemented for any storage backend.

## Built-in: MemoryStore

Included in the core package. Default for all framework adapters.

```ts
import { MemoryStore } from "@jfungus/ratelimit";

const store = new MemoryStore();
store.init(60_000);

rateLimiter({
  limit: 100,
  windowMs: 60_000,
  store,
});
```

**Pros:** Zero dependencies, automatic cleanup, full algorithm support

**Cons:** Data lost on restart, not shared between instances

## Unstorage Adapter

For distributed deployments, use `@jfungus/ratelimit-unstorage` with [unstorage](https://unstorage.unjs.io/).

```bash
npm install @jfungus/ratelimit-unstorage unstorage
```

### Redis

```ts
import { createStorage } from "unstorage";
import redisDriver from "unstorage/drivers/redis";
import { createUnstorageStore } from "@jfungus/ratelimit-unstorage";

const storage = createStorage({
  driver: redisDriver({ url: "redis://localhost:6379" }),
});

const store = createUnstorageStore({ storage });
```

### Cloudflare KV

```ts
import { createStorage } from "unstorage";
import cloudflareKVBindingDriver from "unstorage/drivers/cloudflare-kv-binding";
import { createUnstorageStore } from "@jfungus/ratelimit-unstorage";

const storage = createStorage({
  driver: cloudflareKVBindingDriver({ binding: "RATE_LIMIT_KV" }),
});

const store = createUnstorageStore({ storage });
```

## Custom Store

Implement the `RateLimitStore` interface:

```ts
import type { RateLimitStore, StoreResult } from "@jfungus/ratelimit";

const customStore: RateLimitStore = {
  // Called once before first use
  init(windowMs: number): void {},

  // Required: Increment and return current state
  increment(key: string): StoreResult | Promise<StoreResult> {
    return { count: 1, reset: Date.now() + 60_000 };
  },

  // Required: Reset a key
  resetKey(key: string): void | Promise<void> {},

  // Optional: Required for sliding window algorithm
  get(key: string): StoreResult | undefined | Promise<StoreResult | undefined> {
    return undefined;
  },

  // Optional: For skipSuccessfulRequests
  decrement(key: string): void | Promise<void> {},

  // Optional: Reset all keys
  resetAll(): void | Promise<void> {},

  // Optional: Cleanup connections/timers
  shutdown(): void | Promise<void> {},
};
```

## Store Selection Guide

| Deployment         | Recommended Store         |
| ------------------ | ------------------------- |
| Single instance    | `MemoryStore` (default)   |
| Multiple instances | unstorage + Redis         |
| Cloudflare Workers | unstorage + Cloudflare KV |
| Serverless         | unstorage + Redis/KV      |
