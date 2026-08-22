import assert from "node:assert/strict";
import test from "node:test";
import { isTemporaryAction, PromptStash } from "../core";

test("stores and consumes a prompt", () => {
  const stash = new PromptStash();

  assert.equal(stash.hasPrompt, false);
  stash.stash("draft prompt");
  assert.equal(stash.hasPrompt, true);
  assert.equal(stash.value, "draft prompt");
  assert.equal(stash.take(), "draft prompt");
  assert.equal(stash.take(), undefined);
  assert.equal(stash.hasPrompt, false);
});

test("recognizes slash commands as temporary actions", () => {
  assert.equal(isTemporaryAction("/model"), true);
  assert.equal(isTemporaryAction("  /settings"), true);
  assert.equal(isTemporaryAction("normal prompt"), false);
  assert.equal(isTemporaryAction("!git status"), false);
});
