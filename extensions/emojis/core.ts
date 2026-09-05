import { createRequire } from "node:module";
import { gemoji } from "gemoji";

const require = createRequire(import.meta.url);

const orderedEmoji = require("unicode-emoji-json/data-ordered-emoji.json") as string[];
const dataByEmoji = require("unicode-emoji-json/data-by-emoji.json") as Record<
  string,
  { name: string; slug: string }
>;

// `:name` or `:name:` at the end of the text, preceded by start-of-line or whitespace.
const CURSOR_TOKEN = /(?:^|[ \t])(:([a-zA-Z0-9_+-]+)(:?))$/;
// Standalone `:name:` tokens anywhere in submitted text.
const CLOSED_TOKEN = /(?<=^|[ \t]):([a-zA-Z0-9_+-]+):(?=[ \t]|$)/gm;

/** Structural match for pi-tui's AutocompleteItem. */
export interface AutocompleteItem {
  value: string;
  label: string;
  description?: string;
}

export interface EmojiEntry {
  name: string;
  emoji: string;
  unicodeName: string;
}

export interface EmojiIndex {
  entries: EmojiEntry[];
  byName: Map<string, EmojiEntry>;
}

export interface EmojiToken {
  prefix: string;
  query: string;
  closed: boolean;
}

export function hasSkinToneModifier(emoji: string): boolean {
  return [...emoji].some((char) => {
    const cp = char.codePointAt(0)!;
    return cp >= 0x1f3fb && cp <= 0x1f3ff;
  });
}

/**
 * Builds the shortcode index in Unicode order. Names are Gemoji names followed by the
 * Unicode slug. Gemoji names win over slugs; otherwise first occurrence wins.
 */
export function buildEmojiIndex(): EmojiIndex {
  const gemojiByEmoji = new Map(gemoji.map((record) => [record.emoji, record]));
  const gemojiNames = new Set(gemoji.flatMap((record) => record.names));

  const entries: EmojiEntry[] = [];
  const byName = new Map<string, EmojiEntry>();

  for (const emoji of orderedEmoji) {
    const data = dataByEmoji[emoji];
    if (!data || hasSkinToneModifier(emoji)) continue;

    const names = [...(gemojiByEmoji.get(emoji)?.names ?? [])];
    if (!names.includes(data.slug) && !gemojiNames.has(data.slug)) names.push(data.slug);

    for (const name of names) {
      if (byName.has(name)) continue;
      const entry = { name, emoji, unicodeName: data.name };
      entries.push(entry);
      byName.set(name, entry);
    }
  }

  return { entries, byName };
}

export function extractEmojiToken(textBeforeCursor: string): EmojiToken | undefined {
  const match = CURSOR_TOKEN.exec(textBeforeCursor);
  if (!match) return undefined;
  return { prefix: match[1]!, query: match[2]!, closed: match[3] === ":" };
}

function toItem(entry: EmojiEntry): AutocompleteItem {
  return {
    value: entry.emoji,
    label: entry.name,
    description: `${entry.emoji} ${entry.unicodeName}`,
  };
}

export function getEmojiSuggestions(index: EmojiIndex, token: EmojiToken): AutocompleteItem[] {
  const query = token.query.toLowerCase();

  if (token.closed) {
    const entry = index.byName.get(query);
    return entry ? [toItem(entry)] : [];
  }

  if (query.length < 2) return [];
  return index.entries.filter((entry) => entry.name.startsWith(query)).map(toItem);
}

export function applyEmojiCompletion(
  lines: string[],
  cursorLine: number,
  cursorCol: number,
  item: AutocompleteItem,
  prefix: string,
): { lines: string[]; cursorLine: number; cursorCol: number } {
  const line = lines[cursorLine] ?? "";
  const before = line.slice(0, cursorCol - prefix.length);
  const newLines = [...lines];
  newLines[cursorLine] = before + item.value + line.slice(cursorCol);
  return { lines: newLines, cursorLine, cursorCol: before.length + item.value.length };
}

export function replaceClosedShortcodes(index: EmojiIndex, text: string): string {
  return text.replace(
    CLOSED_TOKEN,
    (token, name: string) => index.byName.get(name.toLowerCase())?.emoji ?? token,
  );
}
