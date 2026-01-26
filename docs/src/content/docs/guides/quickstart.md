---
title: Quick Start
description: Get started with @jf/ratelimit in minutes
---

## Installation

```bash
# For Hono
npm install @jf/ratelimit-hono

# For Express
npm install @jf/ratelimit-express

# For H3/Nitro
npm install @jf/ratelimit-h3

# For Nuxt
npm install @jf/ratelimit-nuxt
```

## Framework Guides

- [Hono](/ratelimit/frameworks/hono/)
- [Express](/ratelimit/frameworks/express/)
- [H3/Nitro](/ratelimit/frameworks/h3/)
- [Nuxt](/ratelimit/frameworks/nuxt/)

## Configuration Options

All framework adapters support these common options:

| Option         | Type                                 | Default            | Description                     |
| -------------- | ------------------------------------ | ------------------ | ------------------------------- |
| `limit`        | `number`                             | `60`               | Maximum requests per window     |
| `windowMs`     | `number`                             | `60000`            | Window duration in milliseconds |
| `algorithm`    | `'fixed-window' \| 'sliding-window'` | `'sliding-window'` | Rate limiting algorithm         |
| `store`        | `RateLimitStore`                     | `MemoryStore`      | Storage backend                 |
| `keyGenerator` | `function`                           | IP-based           | Function to generate client key |
| `skip`         | `function`                           | `undefined`        | Function to skip rate limiting  |
| `handler`      | `function`                           | Default 429        | Custom rate limit response      |
| `dryRun`       | `boolean`                            | `false`            | Log but don't block             |

## Next Steps

- [Algorithms](/ratelimit/concepts/algorithms/) - Learn about fixed vs sliding window
- [Stores](/ratelimit/concepts/stores/) - Use Redis or other distributed stores
