---
title: Quick Start
description: Get started with @jf/ratelimit in under 5 minutes. Install, configure, and protect your API.
---

## Installation

Choose the package for your framework:

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

## Package Guides

Each package has detailed documentation:

- [@jf/ratelimit-hono](/ratelimit/packages/hono/) - Hono & Cloudflare Workers
- [@jf/ratelimit-express](/ratelimit/packages/express/) - Express.js
- [@jf/ratelimit-h3](/ratelimit/packages/h3/) - H3 & Nitro
- [@jf/ratelimit-nuxt](/ratelimit/packages/nuxt/) - Nuxt 3

## Configuration Options

All packages share these common options:

| Option         | Type                                 | Default            | Description                     |
| -------------- | ------------------------------------ | ------------------ | ------------------------------- |
| `limit`        | `number`                             | `60`               | Maximum requests per window     |
| `windowMs`     | `number`                             | `60000`            | Window duration in milliseconds |
| `algorithm`    | `'fixed-window' \| 'sliding-window'` | `'sliding-window'` | Rate limiting algorithm         |
| `store`        | `RateLimitStore`                     | `MemoryStore`      | Storage backend                 |
| `keyGenerator` | `function`                           | IP-based           | Function to generate client key |
| `skip`         | `function`                           | -                  | Function to skip rate limiting  |
| `handler`      | `function`                           | 429 response       | Custom rate limit response      |
| `dryRun`       | `boolean`                            | `false`            | Log but don't block             |

## Next Steps

- [Algorithms](/ratelimit/concepts/algorithms/) - Learn about fixed vs sliding window
- [Stores](/ratelimit/concepts/stores/) - Use Redis or other distributed stores
- [@jf/ratelimit-unstorage](/ratelimit/packages/unstorage/) - Storage adapter for production
