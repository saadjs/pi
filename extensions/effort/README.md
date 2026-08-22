# @saadjs/pi-effort

A tiny pi extension that adds `/effort` for changing the current model's reasoning effort without opening `/settings`.

## Install

```bash
pi install npm:@saadjs/pi-effort
```

For local development:

```bash
pi -e ./extensions/effort/index.ts
```

## Usage

Type `/effort ` and pi suggests only the levels supported by the current model:

```text
/effort high
```

The suggestions update when you switch models. Running `/effort` without a level prints the supported values.
