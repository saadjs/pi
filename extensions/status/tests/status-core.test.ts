import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findUsageProviderAdapter } from "../adapters";
import { fetchCodexUsage } from "../adapters/codex";
import { fetchOpenCodeUsage, parseOpenCodeApiKey } from "../adapters/opencode";

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("Usage provider adapters", () => {
  it("resolves each supported provider through the registry", () => {
    assert.equal(findUsageProviderAdapter("openai-codex")?.displayName, "Codex");
    assert.equal(findUsageProviderAdapter("opencode-go")?.displayName, "OpenCode Go");
    assert.equal(findUsageProviderAdapter("opencode"), undefined);
    assert.equal(findUsageProviderAdapter("unsupported"), undefined);
  });
});

describe("OpenCode usage", () => {
  it("maps rolling, weekly, and monthly limits in display order", async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const limits = await fetchOpenCodeUsage("sk-test", async (url, init) => {
      request = { url, init };
      return response({
        usage: {
          rolling: { status: "ok", percent: 12, resetsAt: "2026-08-16T07:25:27.719Z" },
          weekly: { status: "OK", percent: 37, resetsAt: "2026-08-17T00:00:00Z" },
          monthly: { percent: 18, resetsAt: "2026-09-15T03:32:52.719Z" },
        },
      });
    });

    assert.deepEqual(limits, [
      {
        label: "5-hour",
        usedPercent: 12,
        resetsAt: Date.parse("2026-08-16T07:25:27.719Z") / 1000,
      },
      {
        label: "Weekly",
        usedPercent: 37,
        resetsAt: Date.parse("2026-08-17T00:00:00Z") / 1000,
      },
      {
        label: "Monthly",
        usedPercent: 18,
        resetsAt: Date.parse("2026-09-15T03:32:52.719Z") / 1000,
      },
    ]);
    assert.ok(request);
    assert.equal(request.url, "https://opencode.ai/zen/go/v1/usage");
    assert.equal((request.init.headers as Record<string, string>).Authorization, "Bearer sk-test");
  });

  it("treats rate-limited as exhausted and drops unavailable windows", async () => {
    const limits = await fetchOpenCodeUsage("sk-test", async () =>
      response({
        usage: {
          rolling: { status: "rate-limited", percent: 42 },
          weekly: { status: "unavailable", percent: 0 },
          monthly: { status: "ok", percent: 59 },
        },
      }),
    );

    assert.deepEqual(limits, [
      { label: "5-hour", usedPercent: 100, resetsAt: undefined },
      { label: "Monthly", usedPercent: 59, resetsAt: undefined },
    ]);
  });

  it("keeps unknown statuses and clamps over-quota percents", async () => {
    const limits = await fetchOpenCodeUsage("sk-test", async () =>
      response({
        usage: {
          rolling: { status: "exceeded", percent: 105 },
          weekly: { status: "limited", percent: 88 },
          monthly: { status: "ok", percent: 4 },
        },
      }),
    );

    assert.deepEqual(limits, [
      { label: "5-hour", usedPercent: 100, resetsAt: undefined },
      { label: "Weekly", usedPercent: 88, resetsAt: undefined },
      { label: "Monthly", usedPercent: 4, resetsAt: undefined },
    ]);
  });

  it("reads and trims the opencode-go CLI credential", () => {
    assert.equal(
      parseOpenCodeApiKey({ "opencode-go": { type: "api", key: "  sk-test-key\n" } }),
      "sk-test-key",
    );
    assert.equal(
      parseOpenCodeApiKey({ "opencode-go": { type: "wellknown", key: "wrong-kind" } }),
      undefined,
    );
    assert.equal(parseOpenCodeApiKey({ "opencode-go": { type: "api", key: " " } }), undefined);
    assert.equal(parseOpenCodeApiKey({ opencode: { type: "api", key: "wrong-entry" } }), undefined);
  });

  it("rejects failed or malformed responses", async () => {
    await assert.rejects(
      fetchOpenCodeUsage("token", async () => response({}, 401)),
      /HTTP 401/,
    );
    await assert.rejects(
      fetchOpenCodeUsage("token", async () => response({})),
      /invalid usage response/,
    );
  });
});

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
