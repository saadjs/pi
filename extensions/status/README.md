# @saadjs/pi-status

A non-interactive `/status` extension for pi.

## Supported providers

- OpenAI with Sign in with ChatGPT (`openai`); OpenAI API keys are not supported
- OpenAI Codex (`openai-codex`, "OpenAI Codex (legacy)" in pi 1.0)
- OpenCode Go (`opencode-go`)

## Usage

When a supported model is active, `/status` (and `/usage`) shows its currently reported limit windows. OpenCode Go displays its 5-hour, weekly, and monthly limits.

Pi's Sign in with ChatGPT token cannot read usage, so for `openai` models `/status` borrows the Codex CLI's login from `$CODEX_HOME/auth.json` (defaulting to `~/.codex/auth.json`) and shows your ChatGPT plan's usage limit, which Sign in with ChatGPT shares with Codex. The Codex CLI must be signed in to the same ChatGPT account as pi. `/status` only reads that file and never refreshes it; if the login has expired, run `codex`. Without a Codex CLI login, it links [ChatGPT's usage page](https://chatgpt.com/settings/usage) instead.

OpenCode credentials are resolved from Pi first, then `OPENCODE_API_KEY`, then the OpenCode CLI's `$XDG_DATA_HOME/opencode/auth.json` (defaulting to `~/.local/share/opencode/auth.json`).

## Provider adapters

Provider-specific matching, authentication, and response parsing live in `adapters/`. To add or remove a provider, implement `UsageProviderAdapter` and update the registry in `adapters/index.ts`; the command and bar rendering require no changes.

## Install

```bash
pi install npm:@saadjs/pi-status
```
