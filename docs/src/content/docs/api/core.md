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

**Parameters:**

| Parameter   | Type             | Required | Description                                      |
| ----------- | ---------------- | -------- | ------------------------------------------------ |
| `store`     | `RateLimitStore` | Yes      | Storage backend                                  |
| `key`       | `string`         | Yes      | Unique client identifier                         |
| `limit`     | `number`         | Yes      | Max requests allowed                             |
| `windowMs`  | `number`         | Yes      | Window duration in ms                            |
| `algorithm` | `Algorithm`      | No       | `'fixed-window'` or `'sliding-window'` (default) |

**Returns:** `Promise<CheckRateLimitResult>`

```ts
type CheckRateLimitResult = {
  allowed: boolean;
  info: RateLimitInfo;
};
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

// Usage
const result = await limiter("user:123");
```

**Parameters:** Same as `checkRateLimit` except `key`

**Returns:** `(key: string) => Promise<CheckRateLimitResult>`

## Classes

### MemoryStore

In-memory rate limit store with automatic cleanup.

```ts
import { MemoryStore } from "@jf/ratelimit";

const store = new MemoryStore();
store.init(60_000); // Initialize with window duration

// Use the store...

store.shutdown(); // Clean up when done
```

**Methods:**

| Method      | Signature                                   | Description                     |
| ----------- | ------------------------------------------- | ------------------------------- |
| `init`      | `(windowMs: number) => void`                | Initialize with window duration |
| `increment` | `(key: string) => StoreResult`              | Increment counter               |
| `get`       | `(key: string) => StoreResult \| undefined` | Get current state               |
| `decrement` | `(key: string) => void`                     | Decrement counter               |
| `resetKey`  | `(key: string) => void`                     | Reset specific key              |
| `resetAll`  | `() => void`                                | Reset all keys                  |
| `shutdown`  | `() => void`                                | Clean up timers                 |

## Types

### RateLimitInfo

```ts
type RateLimitInfo = {
  limit: number; // Maximum requests allowed
  remaining: number; // Requests remaining in window
  reset: number; // Unix timestamp (ms) when window resets
};
```

### StoreResult

```ts
type StoreResult = {
  count: number; // Current request count
  reset: number; // Window reset timestamp (ms)
};
```

### Algorithm

```ts
type Algorithm = "fixed-window" | "sliding-window";
```

### RateLimitStore

Interface for implementing custom stores.

```ts
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

### CheckRateLimitOptions

```ts
type CheckRateLimitOptions = {
  store: RateLimitStore;
  key: string;
  limit: number;
  windowMs: number;
  algorithm?: Algorithm;
};
```

### CheckRateLimitResult

```ts
type CheckRateLimitResult = {
  allowed: boolean;
  info: RateLimitInfo;
};
```
