---
title: Introduction
description: What is @jfungus/ratelimit? A multi-framework rate limiting library for Node.js and Edge runtimes.
---

## What is @jfungus/ratelimit?

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
│  @jfungus/ratelimit-hono  │  @jfungus/ratelimit-express  │  ...   │
├─────────────────────────────────────────────────────────┤
│                     @jfungus/ratelimit                        │
│              (core algorithms + MemoryStore)             │
├─────────────────────────────────────────────────────────┤
│     MemoryStore     │     @jfungus/ratelimit-unstorage       │
│    (built-in)       │    (Redis, KV, etc.)              │
└─────────────────────────────────────────────────────────┘
```

## Packages

| Package                                                   | Description                   |
| --------------------------------------------------------- | ----------------------------- |
| [@jfungus/ratelimit](/ratelimit/packages/core/)                | Core algorithms + MemoryStore |
| [@jfungus/ratelimit-hono](/ratelimit/packages/hono/)           | Hono middleware               |
| [@jfungus/ratelimit-express](/ratelimit/packages/express/)     | Express middleware            |
| [@jfungus/ratelimit-h3](/ratelimit/packages/h3/)               | H3/Nitro middleware           |
| [@jfungus/ratelimit-nuxt](/ratelimit/packages/nuxt/)           | Nuxt module                   |
| [@jfungus/ratelimit-unstorage](/ratelimit/packages/unstorage/) | Distributed storage adapter   |

## Algorithms

- **Sliding Window** (default) - Smooth, no burst vulnerability
- **Fixed Window** - Simple, predictable

Learn more in [Algorithms](/ratelimit/concepts/algorithms/).

## Next Steps

- [Quick Start](/ratelimit/guides/quickstart/) - Get up and running
- [Stores](/ratelimit/concepts/stores/) - Configure storage backends
