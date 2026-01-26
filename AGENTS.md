# AGENTS.md - AI Coding Agent Guidelines

## Project Overview

`@jf/ratelimit` is a framework-agnostic rate limiting library implemented as a pnpm monorepo. It provides:
- Core rate limiting logic with sliding-window (default) and fixed-window algorithms
- Framework-specific middleware for Hono, Express, H3/Nitro, and Nuxt
- Storage adapters via unstorage (Redis, Cloudflare KV, Vercel KV, etc.)

## Repository Structure

```
packages/
├── core/       # Core rate limiting logic (MemoryStore, algorithms)
├── hono/       # Hono middleware + Cloudflare Workers support
├── express/    # Express middleware
├── h3/         # H3/Nitro middleware
├── nuxt/       # Nuxt module
└── unstorage/  # Storage adapter for various backends
```

## Build/Lint/Test Commands

### Package Manager
- **pnpm** (v9.14.4) - Always use `pnpm`, never npm or yarn

### Root Commands
```bash
pnpm install        # Install all dependencies
pnpm build          # Build all packages
pnpm test           # Run tests in all packages
pnpm lint           # Check linting with Biome
pnpm lint:fix       # Fix linting issues
pnpm format         # Format code with Biome
pnpm typecheck      # Type-check all packages
pnpm clean          # Clean all packages and node_modules
```

### Running Tests in a Specific Package
```bash
pnpm --filter @jf/ratelimit test           # Core package
pnpm --filter @jf/ratelimit-hono test      # Hono package
pnpm --filter @jf/ratelimit-express test   # Express package
```

### Running a Single Test File
```bash
cd packages/core && pnpm vitest run src/index.test.ts
```

### Running Tests Matching a Pattern
```bash
cd packages/core && pnpm vitest run -t "allows requests under limit"
cd packages/core && pnpm vitest run --testNamePattern="MemoryStore"
```

### Watch Mode
```bash
cd packages/core && pnpm test:watch
```

## Code Style Guidelines

### Formatting (Biome)
- **Indentation**: 2 spaces
- **Quotes**: Single quotes for strings
- **Semicolons**: None (except where required by AST)
- **Line width**: 100 characters max
- **Imports**: Auto-organized by Biome

### TypeScript
- Target: ES2022
- Strict mode enabled with `strictNullChecks` and `noImplicitAny`
- Use `type` keyword for type-only imports: `import type { Foo } from 'bar'`
- Non-null assertions (`!`) are allowed but use sparingly
- Avoid `any` type - it produces warnings

### Naming Conventions
- **Files**: `kebab-case.ts` for source files, `*.test.ts` for tests
- **Types/Interfaces**: `PascalCase` with descriptive names (e.g., `RateLimitInfo`, `StoreResult`)
- **Functions**: `camelCase` (e.g., `checkRateLimit`, `createRateLimiter`)
- **Constants**: `camelCase` for module-level (e.g., `defaultStore`)
- **Classes**: `PascalCase` (e.g., `MemoryStore`)

### Import Order
Biome auto-organizes imports. Manual order preference:
1. External dependencies (e.g., `hono`, `express`)
2. Internal package imports (e.g., `@jf/ratelimit`)
3. Relative imports

### Type Definitions
- Use `type` keyword for type aliases: `export type RateLimitInfo = { ... }`
- Prefer type aliases over interfaces for object shapes
- Export types needed by consumers alongside implementations
- Use JSDoc comments with `@param`, `@returns`, `@example` for public APIs

### Error Handling
- Throw descriptive errors with package prefix: `throw new Error('[@jf/ratelimit] message')`
- Validate inputs at function boundaries
- Use fail-open pattern for store errors by default
- Catch and handle errors in callbacks (e.g., decrement errors are ignored)

### Async/Await
- Always use async/await over raw Promises
- Handle both sync and async returns: `result instanceof Promise ? result : Promise.resolve()`
- Use `void` return type for fire-and-forget async operations

### Testing Patterns
- Import test utilities explicitly: `import { describe, it, expect, vi } from 'vitest'`
- Use `beforeEach`/`afterEach` for setup/teardown
- Always call `store.shutdown()` in `afterEach` to clean up timers
- Use `vi.useFakeTimers()` / `vi.useRealTimers()` for time-based tests
- Use `vi.advanceTimersByTime()` to simulate time passage
- Test files live alongside source: `src/index.ts` → `src/index.test.ts`

### Documentation
- Use JSDoc comments for all exported functions, types, and classes
- Include `@example` blocks for public APIs
- Use section separators for code organization:
  ```typescript
  // ============================================================================
  // Section Name
  // ============================================================================
  ```

### Module Structure Pattern
Each package follows this structure:
```typescript
/**
 * @jf/ratelimit-[package] - Description
 * @module
 */

// External imports
import type { ExternalType } from 'external-package'

// Internal imports
import { MemoryStore, checkRateLimit } from '@jf/ratelimit'

// Re-export core types for consumer convenience
export { MemoryStore, type RateLimitInfo, ... } from '@jf/ratelimit'

// ============================================================================
// Types
// ============================================================================
export type OptionsType = { ... }

// ============================================================================
// Implementation
// ============================================================================
export function middleware(options?: OptionsType) { ... }
```

### Middleware Pattern
Framework middleware follows a consistent pattern:
1. Merge options with defaults using spread: `const opts = { ...defaults, ...options }`
2. Validate configuration early with descriptive errors
3. Initialize store lazily on first request
4. Handle store errors with configurable fail-open/fail-closed behavior
5. Support skip functions for conditional rate limiting
6. Set rate limit info in request/context for downstream access
7. Support dry-run mode for monitoring without blocking

## Package-Specific Notes

### Core (`@jf/ratelimit`)
- Framework-agnostic, zero dependencies
- Provides `MemoryStore` as default storage
- Exports `checkRateLimit()` and `createRateLimiter()` functions
- Algorithms: `sliding-window` (default), `fixed-window`

### Hono (`@jf/ratelimit-hono`)
- Supports multiple header formats: `legacy`, `draft-6`, `draft-7`, `standard`
- Includes `cloudflareRateLimiter()` for Cloudflare Workers bindings
- Sets context variables: `c.get('rateLimit')`, `c.get('rateLimitStore')`

### Express (`@jf/ratelimit-express`)
- Attaches rate limit info to `req.rateLimit`
- Uses `res.on('finish')` for skip options

## Build Configuration

### tsup (bundler)
- Outputs: ESM (`dist/index.js`), CJS (`dist/index.cjs`), types (`dist/index.d.ts`)
- Source maps enabled
- Target: ES2022

### Required Node.js Version
- Node.js >= 18
