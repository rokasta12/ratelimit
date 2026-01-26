---
title: Introduction
description: What is @jf/ratelimit and why use it?
---

## What is @jf/ratelimit?

A multi-framework rate limiting library for JavaScript and TypeScript. Unified API across different web frameworks with pluggable storage backends.

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
