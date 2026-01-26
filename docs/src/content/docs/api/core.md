---
title: Core API
description: API reference for @jf/ratelimit
---

## Installation

```bash
npm install @jf/ratelimit
```

## Functions

### checkRateLimit

Check if a request should be rate limited.

```ts
import { checkRateLimit } from "@jf/ratelimit";

const result = await checkRateLimit({
  store,
  key: "user:123",
  limit: 100,
  windowMs: 60_000,
  algorithm: "sliding-window", // optional
});

// result.allowed: boolean
// result.info: { limit, remaining, reset }
```

### createRateLimiter

Create a reusable rate limiter with pre-configured options.

```ts
import { createRateLimiter, MemoryStore } from "@jf/ratelimit";

const store = new MemoryStore();
store.init(60_000);

const limiter = createRateLimiter({
  store,
  limit: 100,
  windowMs: 60_000,
});

const result = await limiter("user:123");
```

## Classes

### MemoryStore

In-memory rate limit store with automatic cleanup.

```ts
import { MemoryStore } from "@jf/ratelimit";

const store = new MemoryStore();
store.init(60_000);
store.shutdown(); // Clean up when done
```

| Method      | Description                     |
| ----------- | ------------------------------- |
| `init`      | Initialize with window duration |
| `increment` | Increment counter               |
| `get`       | Get current state               |
| `decrement` | Decrement counter               |
| `resetKey`  | Reset specific key              |
| `resetAll`  | Reset all keys                  |
| `shutdown`  | Clean up timers                 |

## Types

```ts
type RateLimitInfo = {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp (ms)
};

type StoreResult = {
  count: number;
  reset: number; // Unix timestamp (ms)
};

type Algorithm = "fixed-window" | "sliding-window";

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
