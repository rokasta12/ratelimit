---
title: Algorithms
description: Understanding rate limiting algorithms
---

## Overview

`@jf/ratelimit` supports two rate limiting algorithms:

1. **Fixed Window** - Simple and predictable
2. **Sliding Window** - Smoother and more accurate (default)

## Fixed Window

Divides time into fixed intervals and counts requests within each window.

```
Window 1 (00:00-01:00)    Window 2 (01:00-02:00)
├─────────────────────┤   ├─────────────────────┤
│ ████████ (8 req)    │   │ ██ (2 req)          │
└─────────────────────┘   └─────────────────────┘
```

```ts
rateLimiter({
  limit: 100,
  windowMs: 60_000,
  algorithm: "fixed-window",
});
```

**Pros:** Simple, low memory, predictable

**Cons:** Burst vulnerability at window boundaries - a client can make 2x the limit by timing requests at window edges

## Sliding Window

Based on [Cloudflare's approach](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/), considers requests from the previous window weighted by elapsed time.

```
Previous Window         Current Window
├─────────────────────┤├─────────────────────┤
│ █████ (50 req)      ││ ██ (20 req)         │
└─────────────────────┘└─────────────────────┘
                        ↑
                     40% into current window
```

**Formula:**

```
estimatedCount = floor(previousCount × weight) + currentCount
weight = (windowMs - elapsedMs) / windowMs
```

**Example:** Previous: 50 req, Current: 20 req, 40% elapsed

- Weight: 0.6
- Estimated: floor(50 × 0.6) + 20 = 50

```ts
rateLimiter({
  limit: 100,
  windowMs: 60_000,
  algorithm: "sliding-window", // default
});
```

**Pros:** Smoother limiting, no burst vulnerability

**Cons:** Requires `get()` method on store

## Which Should I Use?

- **Sliding Window (default)**: Recommended for most use cases
- **Fixed Window**: Use when you need simpler behavior or your store doesn't support `get()`
