---
title: Express
description: Rate limiting for Express applications
---

## Installation

```bash
npm install @jf/ratelimit-express
```

## Basic Usage

```ts
import express from "express";
import { rateLimiter } from "@jf/ratelimit-express";

const app = express();

app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
  }),
);

app.get("/", (req, res) => res.send("Hello!"));

app.listen(3000);
```

## Access Rate Limit Info

```ts
app.get("/api/data", (req, res) => {
  console.log(req.rateLimit);
  // { limit: 100, remaining: 99, reset: 1234567890 }

  res.json({ data: "hello" });
});
```

## Custom Key Generator

```ts
app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? "anonymous",
  }),
);
```

## Custom Response

```ts
app.use(
  rateLimiter({
    limit: 100,
    windowMs: 60_000,
    handler: (req, res, info) => {
      res.status(429).json({
        error: "Too Many Requests",
        retryAfter: Math.ceil((info.reset - Date.now()) / 1000),
      });
    },
  }),
);
```

## With Trust Proxy

When behind a reverse proxy:

```ts
app.set("trust proxy", 1);

app.use(
  rateLimiter({
    keyGenerator: (req) => req.ip, // Now correctly gets client IP
  }),
);
```

## Per-Route Limits

```ts
const apiLimiter = rateLimiter({ limit: 100, windowMs: 60_000 });
const authLimiter = rateLimiter({ limit: 5, windowMs: 60_000 });

app.use("/api/", apiLimiter);
app.use("/auth/", authLimiter);
```
