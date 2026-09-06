import assert from "node:assert/strict";
import test from "node:test";
import { findZsh, resolveZshrc, shellQuote, wrapCommand } from "../core";

test("prefers $SHELL when it is zsh and exists", () => {
  const exists = (p: string) => p === "/custom/zsh";
  assert.equal(findZsh({ SHELL: "/custom/zsh" }, exists), "/custom/zsh");
});

test("falls back to known zsh locations", () => {
  const exists = (p: string) => p === "/opt/homebrew/bin/zsh";
  assert.equal(findZsh({ SHELL: "/bin/bash" }, exists), "/opt/homebrew/bin/zsh");
  assert.equal(
    findZsh({}, () => false),
    undefined,
  );
});

test("resolves zshrc from ZDOTDIR or home", () => {
  assert.equal(resolveZshrc({}, "/home/me"), "/home/me/.zshrc");
  assert.equal(resolveZshrc({ ZDOTDIR: "/dots" }, "/home/me"), "/dots/.zshrc");
});

test("shellQuote escapes single quotes", () => {
  assert.equal(shellQuote("a"), "'a'");
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
});

test("wrapCommand sources rc before eval-ing the command", () => {
  const wrapped = wrapCommand("gst | head -3", "/home/me/.zshrc");
  const lines = wrapped.split("\n");
  assert.equal(lines[0], "export DISABLE_AUTO_UPDATE=true");
  assert.equal(lines[1], "[ -f '/home/me/.zshrc' ] && source '/home/me/.zshrc' >/dev/null 2>&1");
  assert.equal(lines[2], "eval 'gst | head -3'");
});
