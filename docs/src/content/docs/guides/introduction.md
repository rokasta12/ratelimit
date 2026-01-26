---
title: Introduction
description: What is @jf/ratelimit and why use it?
---

## What is @jf/ratelimit?

`@jf/ratelimit` is a multi-framework rate limiting library for JavaScript and TypeScript. It provides a unified API for implementing rate limiting across different web frameworks while allowing framework-specific optimizations.

## Why Another Rate Limiter?

Most rate limiting libraries are tied to a single framework. `@jf/ratelimit` takes a different approach:

1. **Framework-agnostic core**: The rate limiting logic is separate from framework adapters
2. **Consistent API**: Same configuration options across all frameworks
3. **Pluggable storage**: Works with any storage backend via the store interface
4. **Modern algorithms**: Implements Cloudflare's sliding window approach for smoother rate limiting

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Your Application                      │
├─────────────────────────────────────────────────────────┤
│  @jf/ratelimit-hono  │  @jf/ratelimit-express  │  ...   │
├─────────────────────────────────────────────────────────┤
│                     @jf/ratelimit                        │
│              (core algorithms + MemoryStore)             │
├─────────────────────────────────────────────────────────┤
│     MemoryStore     │     @jf/ratelimit-unstorage       │
│    (built-in)       │    (Redis, KV, etc.)              │
└─────────────────────────────────────────────────────────┘
```

## Supported Frameworks

- **Hono** - Lightweight web framework for the Edge
- **Express** - The most popular Node.js framework
- **H3/Nitro** - Universal JavaScript server framework
- **Nuxt** - Vue.js meta-framework (via module)

## Supported Algorithms

- **Fixed Window** - Simple counter that resets at fixed intervals
- **Sliding Window** - Weighted calculation for smoother limiting (default)

## Next Steps

- [Quick Start](/ratelimit/guides/quickstart/) - Get up and running in minutes
- [Algorithms](/ratelimit/concepts/algorithms/) - Learn about the rate limiting algorithms
- [Stores](/ratelimit/concepts/stores/) - Configure storage backends
