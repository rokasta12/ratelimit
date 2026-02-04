FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

# Copy monorepo files for workspace resolution
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/ ./packages/core/
COPY packages/hono/ ./packages/hono/
COPY examples/hono/ ./examples/hono/

RUN pnpm install --frozen-lockfile

# Build packages in dependency order
RUN pnpm --filter @jfungus/ratelimit build
RUN pnpm --filter @jfungus/ratelimit-hono build
RUN pnpm --filter @jfungus/example-hono build

WORKDIR /app/examples/hono
EXPOSE 3000
ENV PORT=3000
CMD ["pnpm", "start"]
