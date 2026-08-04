import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchCodexUsage } from "../core";

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("Codex usage", () => {
  it("uses each API window's duration instead of assuming primary means 5-hour", async () => {
    const limits = await fetchCodexUsage("token", async () =>
      response({
        rate_limit: {
          primary_window: {
            used_percent: 42,
            limit_window_seconds: 18_000,
            reset_after_seconds: 120,
          },
          secondary_window: {
            used_percent: 73,
            limit_window_seconds: 604_800,
            reset_after_seconds: 240,
            reset_at: 1_786_195_772,
          },
        },
      }),
    );

    assert.deepEqual(limits, [
      { label: "5-hour", usedPercent: 42, resetsIn: "2m", resetsAt: undefined },
      { label: "Weekly", usedPercent: 73, resetsIn: "4m", resetsAt: 1_786_195_772 },
    ]);
  });

  it("reports a weekly-only primary window without inventing a 0% limit", async () => {
    const limits = await fetchCodexUsage("token", async () =>
      response({
        rate_limit: {
          primary_window: {
            used_percent: 68,
            limit_window_seconds: 604_800,
            reset_after_seconds: 391_036,
          },
          secondary_window: null,
        },
      }),
    );

    assert.equal(limits.length, 1);
    assert.equal(limits[0]?.label, "Weekly");
    assert.equal(limits[0]?.usedPercent, 68);
  });

  it("rejects failed or malformed responses", async () => {
    await assert.rejects(
      fetchCodexUsage("token", async () => response({}, 401)),
      /HTTP 401/,
    );
    await assert.rejects(
      fetchCodexUsage("token", async () => response({})),
      /invalid usage response/,
    );
  });
});
