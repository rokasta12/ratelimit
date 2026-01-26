# Express Rate Limiting Example

A simple example showing how to use `@jfungus/ratelimit-express` with Express.

## Quick Start

```bash
npm install
npm run dev
```

Then visit http://localhost:3000 and refresh multiple times to see rate limiting in action.

## Try it Online

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/rokasta12/ratelimit/tree/main/examples/express-basic)

## What This Example Shows

- Basic rate limiting setup (10 requests per minute)
- Accessing rate limit info from `req.rateLimit`
- Rate limit headers in response

## Configuration

Edit `src/index.ts` to customize:

```ts
rateLimiter({
  limit: 10, // Max requests per window
  windowMs: 60_000, // Window size (1 minute)
});
```
