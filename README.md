# @saadjs/pi

Monorepo for my pi packages, published as scoped npm packages (`@saadjs/*`) using pnpm workspaces.

## Structure

- `extensions/status` → `@saadjs/pi-status`

## Setup

```bash
cd ~/pi
pnpm install
```

## Development

```bash
pnpm test
pnpm format
pnpm format:check
```

## Formatting + Git hooks (oxfmt + husky + lint-staged)

This repo uses `oxfmt` for formatting and runs it on staged files via a Husky pre-commit hook.

After cloning:

```bash
pnpm install
pnpm prepare
```

## Publishing

Bump the version in the package's `package.json`, then publish:

```bash
pnpm --filter <package-name> publish
```

Example:

```bash
pnpm --filter @saadjs/pi-status publish
```
