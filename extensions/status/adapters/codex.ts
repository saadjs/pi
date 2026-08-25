import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { formatDuration, isObject, numberAtLeast, type FetchUsage, type UsageLimit } from "../core";
import type { UsageProviderAdapter } from "./types";

function parseWindow(value: unknown, fallbackLabel: string): UsageLimit | null {
  if (!isObject(value)) return null;

  const usedPercent = numberAtLeast(value.used_percent, 0);
  if (usedPercent === undefined || usedPercent > 100) return null;

  const windowSeconds = numberAtLeast(value.limit_window_seconds, 1);
  const resetAfterSeconds = numberAtLeast(value.reset_after_seconds, 0);
  let label = fallbackLabel;
  if (windowSeconds === 7 * 86400) label = "Weekly";
  else if (windowSeconds && windowSeconds % 86400 === 0) label = `${windowSeconds / 86400}-day`;
  else if (windowSeconds && windowSeconds % 3600 === 0) label = `${windowSeconds / 3600}-hour`;
  else if (windowSeconds) label = `${formatDuration(windowSeconds)} window`;

  return {
    label,
    usedPercent,
    resetsIn: resetAfterSeconds === undefined ? undefined : formatDuration(resetAfterSeconds),
    resetsAt: numberAtLeast(value.reset_at, 1),
  };
}

export async function fetchCodexUsage(
  token: string,
  fetchUsage: FetchUsage = fetch,
): Promise<UsageLimit[]> {
  const response = await fetchUsage("https://chatgpt.com/backend-api/wham/usage", {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const payload = await response.json();
  if (!isObject(payload) || !isObject(payload.rate_limit)) {
    throw new Error("invalid usage response");
  }

  return [
    parseWindow(payload.rate_limit.primary_window, "Primary"),
    parseWindow(payload.rate_limit.secondary_window, "Secondary"),
  ].filter((limit): limit is UsageLimit => limit !== null);
}

export const codexAdapter: UsageProviderAdapter = {
  providerIds: ["openai-codex"],
  displayName: "Codex",
  async fetchUsage(ctx: ExtensionCommandContext) {
    const token = await ctx.modelRegistry.getApiKeyForProvider("openai-codex");
    if (!token) throw new Error("not logged in for Codex");
    return fetchCodexUsage(token);
  },
};
