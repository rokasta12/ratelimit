# Contributing to @jf/ratelimit

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+

### Setup

1. Fork and clone the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Build all packages:
   ```bash
   pnpm build
   ```
4. Run tests:
   ```bash
   pnpm test
   ```

## Development

### Project Structure

```
packages/
├── core/        # Core rate limiting logic (zero dependencies)
├── hono/        # Hono middleware
├── express/     # Express middleware
├── h3/          # H3/Nitro middleware
├── nuxt/        # Nuxt module
└── unstorage/   # unstorage adapter for distributed stores
docs/            # Astro Starlight documentation site
```

### Commands

| Command       | Description            |
| ------------- | ---------------------- |
| `pnpm build`  | Build all packages     |
| `pnpm test`   | Run all tests          |
| `pnpm lint`   | Lint all packages      |
| `pnpm format` | Format code with Biome |

### Testing

- Write tests for any new features or bug fixes
- Run `pnpm test` to ensure all tests pass
- Each package has its own test file: `src/index.test.ts`

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Add or update tests as needed
4. Update documentation if applicable
5. Run `pnpm build && pnpm test` to ensure everything works
6. Submit a pull request

### Commit Messages

We follow conventional commits:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `test:` - Test changes
- `refactor:` - Code refactoring
- `chore:` - Build/tooling changes

### PR Guidelines

- Keep PRs focused on a single feature or fix
- Add a clear description of changes
- Link any related issues
- Ensure tests pass

## Code Style

This project uses [Biome](https://biomejs.dev/) for linting and formatting. Run `pnpm format` before committing.

### TypeScript Guidelines

- Use strict TypeScript
- Export types along with implementations
- Document public APIs with JSDoc comments
- Avoid `any` - use `unknown` if type is truly unknown

## Questions?

Feel free to open an issue for any questions or discussions.
