# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-01-26

### Added

- Initial release of `@jfungus/ratelimit` monorepo
- **@jfungus/ratelimit** - Core rate limiting library with zero dependencies
  - Fixed window algorithm
  - Sliding window algorithm (Cloudflare-style)
  - In-memory store with automatic cleanup
  - Full TypeScript support
- **@jfungus/ratelimit-hono** - Hono middleware
  - Works with Cloudflare Workers, Deno, Bun, and Node.js
  - Multiple header formats (legacy, draft-6, draft-7, standard)
  - Dynamic rate limits
  - `skipSuccessfulRequests` option
  - Cloudflare Rate Limiting binding support
- **@jfungus/ratelimit-express** - Express middleware
  - `skipSuccessfulRequests` and `skipFailedRequests` options
  - Custom key generator
  - Custom rate limit exceeded handler
- **@jfungus/ratelimit-h3** - H3/Nitro middleware
  - Works with Nitro server middleware
  - Custom key generator and skip options
- **@jfungus/ratelimit-nuxt** - Nuxt 3 module
  - Zero-config setup
  - Automatic integration with Nuxt's `useStorage()`
  - Works with any Nitro storage driver
- **@jfungus/ratelimit-unstorage** - unstorage adapter
  - Support for Redis, Upstash, Cloudflare KV, Vercel KV, and more
  - Easy integration with any unstorage driver

### Documentation

- Full documentation site at https://rokasta12.github.io/ratelimit/
- Individual package READMEs for npm
- Contributing guidelines
- Security policy

[0.0.1]: https://github.com/rokasta12/ratelimit/releases/tag/v0.0.1
