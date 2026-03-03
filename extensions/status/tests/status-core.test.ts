import { describe, expect, it } from "bun:test";
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
    expect(formatDuration(0)).toBe("now");
    expect(formatDuration(61)).toBe("1m");
    expect(formatDuration(3660)).toBe("1h 1m");

    const now = Date.parse("2026-02-18T12:00:00.000Z");
    expect(formatResetsAt("2026-02-18T13:30:00.000Z", now)).toBe("1h 30m");
  });

  it("parses percent candidate from fraction and percentage", () => {
    expect(readPercentCandidate(0.37)).toBe(37);
    expect(readPercentCandidate(88)).toBe(88);
    expect(readPercentCandidate(101)).toBeNull();
  });
});

describe("status-core provider detection and visibility", () => {
  it("detects codex/claude/copilot providers", () => {
    expect(detectProvider({ provider: "openai-codex" })).toBe("codex");
    expect(detectProvider({ provider: "anthropic" })).toBe("claude");
    expect(detectProvider({ provider: "github-copilot" })).toBe("copilot");
    expect(detectProvider({ provider: "openai" })).toBeNull();
  });

  it("checks provider visibility from auth", () => {
    const auth: AuthData = {
      "openai-codex": { access: "a" },
      anthropic: { refresh: "r" },
      "github-copilot": { access: "c" },
    };

    const endpoints = resolveUsageEndpoints();
    expect(canShowForProvider("codex", auth, endpoints)).toBe(true);
    expect(canShowForProvider("claude", auth, endpoints)).toBe(true);
    expect(canShowForProvider("copilot", auth, endpoints)).toBe(true);
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

    expect(usage).toMatchObject({
      session: 42,
      weekly: 73,
      sessionResetsIn: "2m",
      weeklyResetsIn: "4m",
    });
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

    expect(usage.session).toBe(55);
    expect(usage.weekly).toBe(22);
    expect(usage.extraSpend).toBe(7.5);
    expect(usage.extraLimit).toBe(20);
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

    expect(usage.session).toBe(20);
    expect(usage.weekly).toBe(35);
    expect(usage.sessionResetsIn).toBeTruthy();
  });

  it("fetches copilot usage from monthly/limited fallback", async () => {
    const usage = await fetchCopilotUsage("token", {
      fetchFn: async () =>
        jsonResponse(200, {
          monthly_quotas: { completions: 1000, chat: 500 },
          limited_user_quotas: { completions: 400, chat: 250 },
        }),
    });

    expect(usage.session).toBe(60);
    expect(usage.weekly).toBe(50);
    expect(usage.weeklyResetsIn).toBeTruthy();
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

    expect(refreshed.changed).toBe(true);
    expect(refreshed.auth?.anthropic?.access).toBe("fresh-token");
  });
});
