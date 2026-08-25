# @saadjs/pi-status

A non-interactive `/status` extension for pi.

## Supported providers

- OpenAI Codex (`openai-codex`)
- OpenCode Go (`opencode-go`)

## Usage

When a supported model is active, `/status` (and `/usage`) shows its currently reported limit windows. OpenCode Go displays its 5-hour, weekly, and monthly limits.

OpenCode credentials are resolved from Pi first, then `OPENCODE_API_KEY`, then the OpenCode CLI's `$XDG_DATA_HOME/opencode/auth.json` (defaulting to `~/.local/share/opencode/auth.json`).

## Provider adapters

Provider-specific matching, authentication, and response parsing live in `adapters/`. To add or remove a provider, implement `UsageProviderAdapter` and update the registry in `adapters/index.ts`; the command and bar rendering require no changes.

## Install

```bash
pi install npm:@saadjs/pi-status
```
