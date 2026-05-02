import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canShowForProvider,
  detectProvider,
  ensureFreshAuthForProviders,
  fetchCodexUsage,
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
  it("detects codex and rejects unsupported providers", () => {
    assert.equal(detectProvider({ provider: "openai-codex" }), "codex");
    assert.equal(detectProvider({ provider: "anthropic" }), null);
    assert.equal(detectProvider({ provider: "github-copilot" }), null);
    assert.equal(detectProvider({ provider: "openai" }), null);
  });

  it("checks provider visibility from auth", () => {
    const auth: AuthData = {
      "openai-codex": { access: "a" },
    };

    const endpoints = resolveUsageEndpoints();
    assert.equal(canShowForProvider("codex", auth, endpoints), true);
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

  it("refreshes expired oauth credentials", async () => {
    const auth: AuthData = {
      "openai-codex": {
        access: "expired-token",
        refresh: "refresh-token",
        expires: 1,
      },
    };

    const refreshed = await ensureFreshAuthForProviders(["openai-codex"], {
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
    assert.equal(refreshed.auth?.["openai-codex"]?.access, "fresh-token");
  });
});
