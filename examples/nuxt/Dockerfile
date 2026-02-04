FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

# Copy monorepo files for workspace resolution
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/ ./packages/core/
COPY packages/nuxt/ ./packages/nuxt/
COPY examples/nuxt/ ./examples/nuxt/

RUN pnpm install --frozen-lockfile

# Build the ratelimit packages first, then the Nuxt app
RUN pnpm --filter @jfungus/ratelimit build
RUN pnpm --filter @jfungus/ratelimit-nuxt build
RUN pnpm --filter @jfungus/example-nuxt build

WORKDIR /app/examples/nuxt
EXPOSE 3000
ENV PORT=3000
CMD ["node", ".output/server/index.mjs"]
