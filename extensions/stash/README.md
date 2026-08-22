# @saadjs/pi-stash

Claude Code-style prompt stashing for [pi](https://pi.dev).

## Usage

1. Start typing a prompt.
2. Press **Ctrl+S** to stash it and clear the editor.
3. Run a slash command such as `/model`, `/settings`, or `/effort high`.
4. The stashed prompt automatically returns to the editor after the action starts.

Model and thinking-level shortcuts are supported too: after stashing, changing either setting automatically restores the prompt.

Press **Ctrl+S** with an empty editor to restore manually. If both the editor and stash contain text, **Ctrl+S** swaps them. A footer status appears while a prompt is stashed.

The extension composes with an editor installed by an earlier extension. Install editor-replacing extensions before this one if you want both wrappers to apply.

> Prompt attachments are not included because pi's extension API currently exposes editor text only.

## Install

```bash
pi install npm:@saadjs/pi-stash
```

For local development:

```bash
pi -e ./extensions/stash/index.ts
```
