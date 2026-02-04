FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

# Copy monorepo files for workspace resolution
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/ ./packages/core/
COPY packages/h3/ ./packages/h3/
COPY examples/h3/ ./examples/h3/

RUN pnpm install --frozen-lockfile

# Build packages in dependency order
RUN pnpm --filter @jfungus/ratelimit build
RUN pnpm --filter @jfungus/ratelimit-h3 build
RUN pnpm --filter @jfungus/example-h3 build

WORKDIR /app/examples/h3
EXPOSE 3000
ENV PORT=3000
CMD ["pnpm", "start"]
