# @saadjs/pi-context

A minimal pi extension that keeps the active model's context usage visible in the footer:

```text
ctx ████░░░░░░ 42%
```

The bar updates as turns complete, when the model changes, and after context compaction. Colors progress from success to warning at 70%, then error at 90%.

## Install

```bash
pi install npm:@saadjs/pi-context
```

For local development:

```bash
pi -e ./extensions/context/index.ts
```
