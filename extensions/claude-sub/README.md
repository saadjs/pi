# @saadjs/pi-claude-sub

A small Pi extension for Claude Pro/Max OAuth requests.

It keeps Pi's built-in Anthropic login, models, tool mapping, transport, and system prompt.

For Anthropic OAuth access tokens only, it adds a Claude Code-style billing block. API-key requests are untouched.

> ⚠️ **Use at your own risk.** If your Anthropic account gets banned or restricted for using this extension, I take zero responsibility. ⚠️

```bash
pi install npm:@saadjs/pi-claude-sub
# Or test locally:
pi -e ./extensions/claude-sub/index.ts
```

Run `/login anthropic` in Pi and select a Claude model.

If Anthropic raises the minimum supported Claude Code version before this package is updated, set `PI_CLAUDE_SUB_VERSION=X.Y.Z` to a verified current release.
