---
title: Introduction
description: What is @jf/ratelimit? A multi-framework rate limiting library for Node.js and Edge runtimes.
---

## What is @jf/ratelimit?

A rate limiting library for JavaScript and TypeScript that works across frameworks. One consistent API for Hono, Express, H3, Nuxt, and more.

## Why Use It?

- **Framework-agnostic** - Same configuration everywhere
- **Edge-ready** - Works on Cloudflare Workers, Vercel Edge, Deno
- **Production-ready** - Redis, KV storage for distributed deployments
- **Modern algorithms** - Cloudflare-style sliding window prevents bursts

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

## Packages

| Package                                                   | Description                   |
| --------------------------------------------------------- | ----------------------------- |
| [@jf/ratelimit](/ratelimit/packages/core/)                | Core algorithms + MemoryStore |
| [@jf/ratelimit-hono](/ratelimit/packages/hono/)           | Hono middleware               |
| [@jf/ratelimit-express](/ratelimit/packages/express/)     | Express middleware            |
| [@jf/ratelimit-h3](/ratelimit/packages/h3/)               | H3/Nitro middleware           |
| [@jf/ratelimit-nuxt](/ratelimit/packages/nuxt/)           | Nuxt module                   |
| [@jf/ratelimit-unstorage](/ratelimit/packages/unstorage/) | Distributed storage adapter   |

## Algorithms

- **Sliding Window** (default) - Smooth, no burst vulnerability
- **Fixed Window** - Simple, predictable

Learn more in [Algorithms](/ratelimit/concepts/algorithms/).

## Next Steps

- [Quick Start](/ratelimit/guides/quickstart/) - Get up and running
- [Stores](/ratelimit/concepts/stores/) - Configure storage backends
