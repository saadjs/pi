import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canShowForProvider,
  detectProvider,
  ensureFreshAuthForProviders,
  fetchClaudeUsage,
  fetchCodexUsage,
  fetchCopilotUsage,
  formatDuration,
  formatResetsAt,
  readPercentCandidate,
  resolveUsageEndpoints,
  type AuthData,
  type FetchResponseLike,
} from "../core";

function jsonResponse(status: number, body: any): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("status-core formatting", () => {
  it("formats durations and reset times", () => {
    assert.equal(formatDuration(0), "now");
    assert.equal(formatDuration(61), "1m");
    assert.equal(formatDuration(3660), "1h 1m");

    const now = Date.parse("2026-02-18T12:00:00.000Z");
    assert.equal(formatResetsAt("2026-02-18T13:30:00.000Z", now), "1h 30m");
  });

  it("parses percent candidate from fraction and percentage", () => {
    assert.equal(readPercentCandidate(0.37), 37);
    assert.equal(readPercentCandidate(88), 88);
    assert.equal(readPercentCandidate(101), null);
  });
});

describe("status-core provider detection and visibility", () => {
  it("detects codex/claude/copilot providers", () => {
    assert.equal(detectProvider({ provider: "openai-codex" }), "codex");
    assert.equal(detectProvider({ provider: "anthropic" }), "claude");
    assert.equal(detectProvider({ provider: "github-copilot" }), "copilot");
    assert.equal(detectProvider({ provider: "openai" }), null);
  });

  it("checks provider visibility from auth", () => {
    const auth: AuthData = {
      "openai-codex": { access: "a" },
      anthropic: { refresh: "r" },
      "github-copilot": { access: "c" },
    };

    const endpoints = resolveUsageEndpoints();
    assert.equal(canShowForProvider("codex", auth, endpoints), true);
    assert.equal(canShowForProvider("claude", auth, endpoints), true);
    assert.equal(canShowForProvider("copilot", auth, endpoints), true);
  });
});

describe("status-core network fetchers", () => {
  it("fetches codex usage", async () => {
    const usage = await fetchCodexUsage("token", {
      fetchFn: async () =>
        jsonResponse(200, {
          rate_limit: {
            primary_window: { used_percent: 42, reset_after_seconds: 120 },
            secondary_window: { used_percent: 73, reset_after_seconds: 240 },
          },
        }),
    });

    assert.equal(usage.session, 42);
    assert.equal(usage.weekly, 73);
    assert.equal(usage.sessionResetsIn, "2m");
    assert.equal(usage.weeklyResetsIn, "4m");
  });

  it("fetches claude usage with extra usage and weekly fallback", async () => {
    const usage = await fetchClaudeUsage("token", {
      fetchFn: async () =>
        jsonResponse(200, {
          five_hour: { utilization: 55, resets_at: "2026-02-18T13:00:00.000Z" },
          seven_day_sonnet: { utilization: 22, resets_at: "2026-02-19T13:00:00.000Z" },
          extra_usage: { is_enabled: true, used_credits: 7.5, monthly_limit: 20 },
        }),
    });

    assert.equal(usage.session, 55);
    assert.equal(usage.weekly, 22);
    assert.equal(usage.extraSpend, 7.5);
    assert.equal(usage.extraLimit, 20);
  });

  it("fetches copilot usage from quota snapshots", async () => {
    const usage = await fetchCopilotUsage("token", {
      fetchFn: async () =>
        jsonResponse(200, {
          quota_snapshots: {
            premium_interactions: { percent_remaining: 80 },
            chat: { percent_remaining: 65 },
          },
          copilot_plan: "individual",
        }),
    });

    assert.equal(usage.session, 20);
    assert.equal(usage.weekly, 35);
    assert.ok(usage.sessionResetsIn);
  });

  it("fetches copilot usage from monthly/limited fallback", async () => {
    const usage = await fetchCopilotUsage("token", {
      fetchFn: async () =>
        jsonResponse(200, {
          monthly_quotas: { completions: 1000, chat: 500 },
          limited_user_quotas: { completions: 400, chat: 250 },
        }),
    });

    assert.equal(usage.session, 60);
    assert.equal(usage.weekly, 50);
    assert.ok(usage.weeklyResetsIn);
  });

  it("refreshes expired oauth credentials", async () => {
    const auth: AuthData = {
      anthropic: {
        access: "expired-token",
        refresh: "refresh-token",
        expires: 1,
      },
    };

    const refreshed = await ensureFreshAuthForProviders(["anthropic"], {
      auth,
      nowMs: 10_000,
      persist: false,
      oauthResolver: async () => ({
        apiKey: "ignored",
        newCredentials: {
          access: "fresh-token",
          refresh: "refresh-token",
          expires: 999_999,
        },
      }),
    });

    assert.equal(refreshed.changed, true);
    assert.equal(refreshed.auth?.anthropic?.access, "fresh-token");
  });
});
