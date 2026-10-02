# @saadjs/pi-status

## 0.2.0

### Minor Changes

- Support Sign in with ChatGPT on the `openai` provider. Its tokens cannot read usage, so `/status` reads the Codex CLI's login and shows the plan's usage limit, which Sign in with ChatGPT shares with Codex, or links ChatGPT's usage page when the Codex CLI is not signed in. OpenAI API keys remain unsupported.

### Patch Changes

- Depend on `@earendil-works/pi-coding-agent` instead of the old `@mariozechner/pi-coding-agent` name.
- Show the unsupported-provider summary as info so pi 1.0's `Warning:` prefix no longer misaligns it.

## 0.1.0

### Minor Changes

- Add OpenCode Go usage with 5-hour, weekly, and monthly limit bars.
- Resolve OpenCode credentials from Pi, the environment, or the OpenCode CLI auth file.
- Isolate provider matching, authentication, and response parsing behind provider adapters.

## 0.0.4

### Patch Changes

- Support weekly-only limits for ChatGPT Codex.
- Refactor the extension for a leaner implementation.

## 0.0.3

### Patch Changes

- f00baf1: add (5h) to session usage label, remove unused pi-tui peer dependency

## 0.0.2

### Patch Changes

- Remove Anthropic Claude and GitHub Copilot provider support from /status.

## 0.0.1

### Patch Changes

- Initial public release of /status extension for Pi Coding Agent with support for Codex.
