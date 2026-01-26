---
title: "@jfungus/ratelimit"
description: "Core rate limiting library with sliding window algorithm and in-memory store for Node.js and Edge runtimes."
---

The core package provides rate limiting algorithms and a built-in memory store. Use it directly or through framework adapters.

## Installation

```bash
npm install @jfungus/ratelimit
```

## When to Use

- Building custom framework integrations
- Need direct access to rate limiting logic
- Using with frameworks not officially supported

For Hono, Express, H3, or Nuxt, use the dedicated packages instead.

## Basic Usage

```ts
import { checkRateLimit, MemoryStore } from "@jfungus/ratelimit";

const store = new MemoryStore();
store.init(60 * 1000); // 1 minute window

async function handleRequest(userId: string) {
  const result = await checkRateLimit({
    store,
    key: userId,
    limit: 100,
    windowMs: 60 * 1000, // 1 minute
  });

  if (!result.allowed) {
    return { error: "Rate limited", retryAfter: result.info.reset };
  }

  return { success: true };
}
```

## createRateLimiter

Create a reusable rate limiter function:

```ts
import { createRateLimiter, MemoryStore } from "@jfungus/ratelimit";

const store = new MemoryStore();
store.init(60 * 1000); // 1 minute

const limiter = createRateLimiter({
  store,
  limit: 100,
  windowMs: 60 * 1000, // 1 minute
  algorithm: "sliding-window", // default
});

// Usage
const result = await limiter("user:123");
console.log(result.allowed); // true or false
console.log(result.info); // { limit, remaining, reset }
```

## MemoryStore

Built-in store for single-instance deployments:

```ts
import { MemoryStore } from "@jfungus/ratelimit";

const store = new MemoryStore();
store.init(60 * 1000); // 1 minute

// Methods
store.increment("key"); // Returns { count, reset }
store.get("key"); // Returns { count, reset } or undefined
store.decrement("key"); // Decrease counter
store.resetKey("key"); // Delete specific key
store.resetAll(); // Clear all data
store.shutdown(); // Clean up timers
```

## Types

```ts
type Algorithm = "fixed-window" | "sliding-window";

type RateLimitInfo = {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp (ms)
};

type StoreResult = {
  count: number;
  reset: number;
};

type RateLimitStore = {
  init?: (windowMs: number) => void | Promise<void>;
  increment: (key: string) => StoreResult | Promise<StoreResult>;
  get?: (
    key: string,
  ) => StoreResult | undefined | Promise<StoreResult | undefined>;
  decrement?: (key: string) => void | Promise<void>;
  resetKey: (key: string) => void | Promise<void>;
  resetAll?: () => void | Promise<void>;
  shutdown?: () => void | Promise<void>;
};
```

## Related

- [Algorithms](/ratelimit/concepts/algorithms/) - How sliding window works
- [Stores](/ratelimit/concepts/stores/) - Custom store implementation
