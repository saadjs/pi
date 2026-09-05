import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { gemoji } from "gemoji";
import {
  applyEmojiCompletion,
  buildEmojiIndex,
  extractEmojiToken,
  followsClosedEmojiToken,
  getEmojiSuggestions,
  hasSkinToneModifier as hasSkinTone,
  replaceClosedShortcodes,
} from "../core";

const require = createRequire(import.meta.url);
const orderedEmoji = require("unicode-emoji-json/data-ordered-emoji.json") as string[];
const dataByEmoji = require("unicode-emoji-json/data-by-emoji.json") as Record<
  string,
  { name: string; slug: string }
>;

const index = buildEmojiIndex();

function token(text: string) {
  const result = extractEmojiToken(text);
  assert.ok(result, `expected an emoji token in ${JSON.stringify(text)}`);
  return result;
}

function suggestions(text: string) {
  return getEmojiSuggestions(index, token(text));
}

describe("emoji data and index", () => {
  it("uses the pinned inventory sizes", () => {
    assert.equal(orderedEmoji.length, 1914);
    assert.equal(gemoji.length, 1870);
  });

  it("includes every non-skin-tone Unicode emoji in ordered data", () => {
    const indexedEmoji = new Set(index.entries.map((entry) => entry.emoji));
    for (const emoji of orderedEmoji) {
      if (!hasSkinTone(emoji)) assert.ok(indexedEmoji.has(emoji), emoji);
    }
  });

  it("preserves multi-codepoint emoji sequences exactly", () => {
    assert.ok(index.entries.some((entry) => entry.emoji === "🇺🇸"));
    assert.ok(index.entries.some((entry) => entry.emoji === "👨‍👩‍👧"));
  });

  it("keeps every Gemoji record inside the Unicode inventory", () => {
    assert.equal(gemoji.filter(({ emoji }) => dataByEmoji[emoji] === undefined).length, 0);
  });

  it("has 44 slug-only Unicode emoji", () => {
    const gemojiEmoji = new Set(gemoji.map(({ emoji }) => emoji));
    assert.equal(
      orderedEmoji.filter((emoji) => !gemojiEmoji.has(emoji) && !hasSkinTone(emoji)).length,
      44,
    );
  });

  it("resolves Gemoji names and Unicode slugs", () => {
    assert.equal(index.byName.get("tada")?.emoji, "🎉");
    assert.equal(index.byName.get("thumbsup")?.emoji, "👍");
    assert.equal(index.byName.get("+1")?.emoji, "👍");
    assert.equal(index.byName.get("-1")?.emoji, "👎");
    assert.equal(index.byName.get("rocket")?.emoji, "🚀");
    assert.equal(index.byName.get("thumbs_up")?.emoji, "👍");
    assert.equal(index.byName.get("party_popper")?.emoji, "🎉");
    assert.ok(index.byName.has("head_shaking_horizontally"));
  });

  it("preserves published name order and does not use tags as names", () => {
    assert.deepEqual(
      index.entries.filter((entry) => entry.emoji === "👍").map((entry) => entry.name),
      ["+1", "thumbsup", "thumbs_up"],
    );
    assert.equal(index.byName.has("hooray"), false);
    assert.equal(index.byName.has("party"), false);
  });

  it("contains no skin-tone modifiers or ambiguous names", () => {
    for (const entry of index.entries) {
      assert.equal(hasSkinTone(entry.emoji), false, entry.name);
      assert.match(entry.name, /^[a-z0-9_+-]+$/);
    }

    const names = new Map<string, string>();
    for (const entry of index.entries) {
      const previous = names.get(entry.name);
      if (previous !== undefined) assert.equal(previous, entry.emoji, entry.name);
      names.set(entry.name, entry.emoji);
    }
  });

  it("follows Unicode order rather than Gemoji order", () => {
    assert.deepEqual(index.entries[0], {
      name: "grinning",
      emoji: "😀",
      unicodeName: dataByEmoji["😀"]!.name,
    });

    const firstEntryIndex = (emoji: string) =>
      index.entries.findIndex((entry) => entry.emoji === emoji);
    assert.equal(
      firstEntryIndex("🎉") > firstEntryIndex("🚀"),
      orderedEmoji.indexOf("🎉") > orderedEmoji.indexOf("🚀"),
    );
  });
});

describe("emoji token parsing", () => {
  it("parses open, closed, and punctuation names", () => {
    assert.deepEqual(token(":t"), {
      prefix: ":t",
      query: "t",
      closed: false,
    });
    assert.deepEqual(token(":ta"), {
      prefix: ":ta",
      query: "ta",
      closed: false,
    });
    assert.deepEqual(token(":thumbs"), {
      prefix: ":thumbs",
      query: "thumbs",
      closed: false,
    });
    assert.deepEqual(token(":tada:"), {
      prefix: ":tada:",
      query: "tada",
      closed: true,
    });
    assert.deepEqual(token(":+1"), {
      prefix: ":+1",
      query: "+1",
      closed: false,
    });
    assert.deepEqual(token(":-1"), {
      prefix: ":-1",
      query: "-1",
      closed: false,
    });
  });

  it("requires a token boundary", () => {
    assert.deepEqual(token("hello :ta"), {
      prefix: ":ta",
      query: "ta",
      closed: false,
    });
    assert.deepEqual(token("hello\t:ta"), {
      prefix: ":ta",
      query: "ta",
      closed: false,
    });
    assert.deepEqual(token(":ta"), {
      prefix: ":ta",
      query: "ta",
      closed: false,
    });

    for (const text of [":", "foo :", "key:value", "http://example.com", "10:30"]) {
      assert.equal(extractEmojiToken(text), undefined, text);
    }
  });

  it("recognizes whitespace immediately after a closed shortcode", () => {
    for (const text of [":tada: ", "hello :TADA:\t", "hello :party_popper:  "]) {
      assert.equal(followsClosedEmojiToken(index, text), true, text);
    }

    for (const text of [":tada:", ":unknown: ", "x:tada: ", ":tada: next "]) {
      assert.equal(followsClosedEmojiToken(index, text), false, text);
    }
  });
});

describe("emoji matching", () => {
  it("does not suggest for one-character or unknown open queries", () => {
    assert.deepEqual(suggestions(":t"), []);
    assert.deepEqual(suggestions(":zzzzzz"), []);
  });

  it("matches case-insensitive prefixes in index order", () => {
    const lower = suggestions(":ta");
    const upper = suggestions(":TA");
    assert.ok(lower.length > 0);
    assert.deepEqual(upper, lower);
    assert.ok(lower.every((item) => item.label.startsWith("ta")));

    const expected = index.entries
      .filter((entry) => entry.name.startsWith("ta"))
      .map((entry) => entry.name);
    assert.deepEqual(
      lower.map((item) => item.label),
      expected,
    );
  });

  it("keeps the published thumb prefix order", () => {
    const matches = suggestions(":thumbs").map((item) => item.label);
    assert.equal(matches[0], "thumbsup");
    assert.equal(matches[1], "thumbs_up");
  });

  it("requires exact names for closed tokens", () => {
    assert.deepEqual(suggestions(":tad:"), []);
    assert.deepEqual(suggestions(":hooray"), []);
    assert.deepEqual(
      suggestions(":tada:").map((item) => item.value),
      ["🎉"],
    );
  });

  it("returns the native autocomplete item shape", () => {
    const item = suggestions(":tada:")[0];
    assert.deepEqual(item, {
      value: "🎉",
      label: "tada",
      description: "🎉 party popper",
    });
  });
});

describe("emoji completion replacement", () => {
  it("replaces only the active token without adding a space", () => {
    const item = suggestions(":thumbs").find((suggestion) => suggestion.label === "thumbs_up")!;
    assert.deepEqual(
      applyEmojiCompletion(["hello :thumbs"], 0, "hello :thumbs".length, item, ":thumbs"),
      {
        lines: ["hello 👍"],
        cursorLine: 0,
        cursorCol: "hello 👍".length,
      },
    );
  });

  it("preserves text after the cursor", () => {
    const item = suggestions(":tada:")[0]!;
    const line = "before :tada: after";
    const cursorCol = "before :tada:".length;
    assert.deepEqual(applyEmojiCompletion([line], 0, cursorCol, item, ":tada:"), {
      lines: ["before 🎉 after"],
      cursorLine: 0,
      cursorCol: "before 🎉".length,
    });
  });

  it("changes only the cursor line in multiline input", () => {
    const item = suggestions(":rocket:")[0]!;
    const lines = ["first", "second :rocket:", "third"];
    const cursorCol = lines[1]!.length;
    const result = applyEmojiCompletion(lines, 1, cursorCol, item, ":rocket:");
    assert.deepEqual(result.lines, ["first", "second 🚀", "third"]);
    assert.equal(result.cursorLine, 1);
    assert.equal(result.cursorCol, "second 🚀".length);
  });
});

describe("submitted shortcode replacement", () => {
  it("replaces recognized closed shortcodes", () => {
    assert.equal(replaceClosedShortcodes(index, ":tada:"), "🎉");
    assert.equal(replaceClosedShortcodes(index, "ship it :rocket: now"), "ship it 🚀 now");
    assert.equal(replaceClosedShortcodes(index, ":TADA:"), "🎉");
    assert.equal(replaceClosedShortcodes(index, ":+1:"), "👍");
  });

  it("replaces every token across lines", () => {
    assert.equal(
      replaceClosedShortcodes(index, ":tada: :rocket:\n:+1:\nlast :party_popper:"),
      "🎉 🚀\n👍\nlast 🎉",
    );
  });

  it("leaves open, unknown, and non-token text unchanged", () => {
    for (const text of [
      ":tada",
      ":unknown_name:",
      "key:value",
      "a:b:c",
      "x:tada:",
      ":tada:foo",
      "10:30:45",
    ]) {
      assert.equal(replaceClosedShortcodes(index, text), text, text);
    }
  });

  it("handles tokens at text boundaries and inside code spans", () => {
    assert.equal(
      replaceClosedShortcodes(index, ":rocket: at start and end :tada:"),
      "🚀 at start and end 🎉",
    );
    assert.equal(
      replaceClosedShortcodes(index, "` :+1: ` remains text but resolves"),
      "` 👍 ` remains text but resolves",
    );
  });
});
