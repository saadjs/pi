import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  applyEmojiCompletion,
  buildEmojiIndex,
  extractEmojiToken,
  followsClosedEmojiToken,
  getEmojiSuggestions,
  replaceClosedShortcodes,
} from "./core";

const index = buildEmojiIndex();

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.addAutocompleteProvider((current) => ({
      triggerCharacters: [":"],

      async getSuggestions(lines, cursorLine, cursorCol, options) {
        const fallback = () => current.getSuggestions(lines, cursorLine, cursorCol, options);

        // Leave slash-command argument completion to the built-in provider.
        if (lines[0]?.startsWith("/")) return fallback();

        const textBeforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
        const token = extractEmojiToken(textBeforeCursor);
        if (!token) {
          // Typing whitespace while emoji suggestions are open asks the provider to update.
          // Do not let that stale update fall through to pi's natural trailing-space file picker.
          if (!options.force && followsClosedEmojiToken(index, textBeforeCursor)) return null;
          return fallback();
        }

        const items = getEmojiSuggestions(index, token);
        return items.length > 0 ? { prefix: token.prefix, items } : fallback();
      },

      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        // The built-in provider never returns a `:`-prefixed prefix, so this is ours.
        if (prefix.startsWith(":")) {
          return applyEmojiCompletion(lines, cursorLine, cursorCol, item, prefix);
        }
        return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      },

      shouldTriggerFileCompletion: current.shouldTriggerFileCompletion?.bind(current),
    }));
  });

  pi.on("input", (event) => {
    if (event.source === "extension") return;
    const text = replaceClosedShortcodes(index, event.text);
    if (text !== event.text) return { action: "transform", text };
  });
}
