import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampPercent, colorForPercent, formatPercent, getContextProgress } from "../core";

describe("context progress", () => {
  it("builds progress from context usage", () => {
    assert.deepEqual(getContextProgress({ tokens: 42_000, contextWindow: 100_000, percent: 42 }), {
      percent: 42,
      filled: 4,
      empty: 6,
      color: "success",
    });
  });

  it("handles unknown usage after compaction", () => {
    assert.deepEqual(getContextProgress({ tokens: null, contextWindow: 100_000, percent: null }), {
      percent: null,
      filled: 0,
      empty: 10,
      color: "success",
    });
    assert.equal(formatPercent(null), "--%");
  });

  it("clamps values and changes color near the context limit", () => {
    assert.equal(clampPercent(101), 100);
    assert.equal(clampPercent(-1), 0);
    assert.equal(colorForPercent(69.9), "success");
    assert.equal(colorForPercent(70), "warning");
    assert.equal(colorForPercent(90), "error");
    assert.equal(formatPercent(89.6), "90%");
  });
});
