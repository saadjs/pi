import assert from "node:assert/strict";
import { it } from "node:test";
import { formatPreview, isGhostty, notificationSequence, notificationTitle } from "../core.ts";

it("recognizes Ghostty without claiming support for unrelated terminals", () => {
  assert.equal(isGhostty({ TERM: "xterm-ghostty" }), true);
  assert.equal(isGhostty({ TERM_PROGRAM: "ghostty", TERM: "xterm-256color" }), true);
  assert.equal(isGhostty({ TERM_PROGRAM: "Ghostty" }), true);
  assert.equal(isGhostty({ TERM: "xterm-256color", TERM_PROGRAM: "iTerm.app" }), false);
  assert.equal(isGhostty({}), false);
});

it("cleans Markdown and preserves inline code identifiers and link labels", () => {
  const text =
    "## **Finished**\n\n- Updated `my_file.ts` and [tests](https://example.com).\n> All **12 tests** pass.\n```ts\nsecret code\n```\n~~~sh\nmore code\n~~~";
  assert.equal(formatPreview(text), "Finished Updated my_file.ts and tests. All 12 tests pass.");
  assert.equal(
    formatPreview("*Ready* with __bold__ and ~~old~~ text."),
    "Ready with bold and old text.",
  );
  assert.equal(formatPreview("```ts\ncode only\n```"), "");
});

it("bounds previews by Unicode code points without splitting surrogate pairs", () => {
  assert.equal(formatPreview("x".repeat(160)), "x".repeat(160));
  assert.equal(formatPreview("x".repeat(161)), "x".repeat(159) + "…");
  const result = formatPreview("😀".repeat(170));
  assert.equal(Array.from(result).length, 160);
  assert.equal(result, "😀".repeat(159) + "…");
});

it("formats project/session titles and prevents delimiter injection", () => {
  assert.equal(notificationTitle("/Users/saad/src/app"), "Pi · app");
  assert.equal(notificationTitle("/Users/saad/src/app", "Fix tests"), "Pi · app · Fix tests");
  assert.equal(notificationTitle("/"), "Pi · /");
  assert.equal(notificationTitle("/tmp/a;b", "hello;world\nnext"), "Pi · a,b · hello,world next");
  assert.equal(Array.from(notificationTitle("/tmp/app", "😀".repeat(150))).length, 120);
});

it("strips ANSI and control characters before writing the OSC protocol", () => {
  const body = "\x1b[31mDone\x1b[0m\n\x1b]0;injected\x07OK\x00\x9c";
  assert.equal(formatPreview(body), "Done OK");
  assert.equal(notificationSequence("Pi;bad\x07", body), "\x1b]777;notify;Pi,bad;Done OK\x07");
  assert.equal(notificationSequence("Pi", "one;two"), "\x1b]777;notify;Pi;one;two\x07");
  const sequence = notificationSequence("x".repeat(200), "y".repeat(200));
  assert.equal(sequence, `\x1b]777;notify;${"x".repeat(119)}…;${"y".repeat(159)}…\x07`);
});
