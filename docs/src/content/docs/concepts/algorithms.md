---
title: Algorithms
description: Understanding rate limiting algorithms
---

## Overview

`@jf/ratelimit` supports two rate limiting algorithms:

1. **Fixed Window** - Simple and predictable
2. **Sliding Window** - Smoother and more accurate (default)

## Fixed Window

The fixed window algorithm divides time into fixed intervals (windows) and counts requests within each window.

### How It Works

```
Window 1 (00:00-01:00)    Window 2 (01:00-02:00)
├─────────────────────┤   ├─────────────────────┤
│ ████████ (8 req)    │   │ ██ (2 req)          │
└─────────────────────┘   └─────────────────────┘
```

- Requests are counted per window
- Counter resets at window boundary
- Simple to implement and understand

### Configuration

```ts
rateLimiter({
  limit: 100,
  windowMs: 60_000,
  algorithm: "fixed-window",
});
```

### Pros & Cons

**Pros:**

- Simple to understand
- Low memory usage
- Predictable behavior

**Cons:**

- Burst vulnerability at window boundaries
- A client can make 2x the limit in a short period by timing requests at window edges

### Burst Problem Example

```
Window 1 End          Window 2 Start
      ↓                    ↓
──────┼────────────────────┼──────
   99 requests          100 requests
   at 00:59:59          at 01:00:00
```

A client could make 199 requests in 2 seconds while staying under the "100 per minute" limit.

## Sliding Window

The sliding window algorithm provides smoother rate limiting by considering requests from the previous window.

### How It Works

Based on [Cloudflare's sliding window approach](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/):

```
Previous Window         Current Window
├─────────────────────┤├─────────────────────┤
│ █████ (50 req)      ││ ██ (20 req)         │
└─────────────────────┘└─────────────────────┘
                        ↑
                     We are here (40% into current window)
```

**Formula:**

```
estimatedCount = floor(previousCount × weight) + currentCount
weight = (windowMs - elapsedMs) / windowMs
```

**Example:**

- Previous window: 50 requests
- Current window: 20 requests
- Elapsed time in current window: 24 seconds (40%)
- Weight: (60 - 24) / 60 = 0.6
- Estimated count: floor(50 × 0.6) + 20 = 30 + 20 = 50

### Configuration

```ts
rateLimiter({
  limit: 100,
  windowMs: 60_000,
  algorithm: "sliding-window", // This is the default
});
```

### Pros & Cons

**Pros:**

- Smoother rate limiting
- No burst vulnerability
- More accurate limiting

**Cons:**

- Slightly more complex
- Requires `get()` method on store (for previous window data)
- Minor additional memory usage

## Comparison

| Feature            | Fixed Window       | Sliding Window          |
| ------------------ | ------------------ | ----------------------- |
| Burst protection   | No                 | Yes                     |
| Memory usage       | Lower              | Slightly higher         |
| Complexity         | Simple             | Moderate                |
| Store requirements | `increment()` only | `increment()` + `get()` |
| Default            | No                 | Yes                     |

## Which Should I Use?

- **Sliding Window (default)**: Recommended for most use cases. Provides smoother, more predictable rate limiting without burst vulnerabilities.

- **Fixed Window**: Use when you need simpler behavior, lower memory usage, or when your store doesn't support the `get()` method.

## Store Compatibility

Both algorithms work with all stores, but sliding window requires the `get()` method:

```ts
// If store doesn't have get(), sliding window will warn and
// behave like fixed window
const minimalStore = {
  increment: (key) => ({ count: 1, reset: Date.now() + 60000 }),
  resetKey: (key) => {},
};

// MemoryStore and UnstorageStore both support get()
import { MemoryStore } from "@jf/ratelimit";
const store = new MemoryStore(); // Full support for both algorithms
```
