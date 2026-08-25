import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { isObject, numberAtLeast, type FetchUsage, type UsageLimit } from "../core";
import type { UsageProviderAdapter } from "./types";

const OPENCODE_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const OPENCODE_PROVIDER_IDS = ["opencode-go"] as const;

function parseWindow(value: unknown, label: string): UsageLimit | null {
  if (!isObject(value)) return null;

  const status = typeof value.status === "string" ? value.status.trim().toLowerCase() : undefined;
  if (status === "unavailable") return null;
  const rateLimited = status === "rate-limited" || status === "rate_limited";

  const percent = numberAtLeast(value.percent, 0);
  // Over-quota may arrive as percent > 100; clamp so a full bar shows instead of the window vanishing.
  const usedPercent = rateLimited
    ? 100
    : percent === undefined
      ? undefined
      : Math.min(percent, 100);
  if (usedPercent === undefined) return null;

  let resetsAt: number | undefined;
  if (typeof value.resetsAt === "string") {
    const milliseconds = Date.parse(value.resetsAt);
    if (Number.isFinite(milliseconds)) resetsAt = milliseconds / 1000;
  }

  return { label, usedPercent, resetsAt };
}

export function parseOpenCodeApiKey(payload: unknown): string | undefined {
  if (!isObject(payload) || !isObject(payload["opencode-go"])) return undefined;
  const credential = payload["opencode-go"];
  if (credential.type !== "api" || typeof credential.key !== "string") return undefined;
  return credential.key.trim() || undefined;
}

async function cliApiKey(): Promise<string | undefined> {
  const environmentKey = process.env.OPENCODE_API_KEY?.trim();
  if (environmentKey) return environmentKey;

  const dataHome = process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
  const authPath = join(dataHome, "opencode", "auth.json");

  let contents: string;
  try {
    contents = await readFile(authPath, "utf8");
  } catch (error) {
    // Only a missing file means "not logged in"; anything else is a real problem worth reporting.
    const code = isObject(error) ? error.code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw new Error(`cannot read ${authPath}: ${(error as Error).message}`);
  }

  try {
    return parseOpenCodeApiKey(JSON.parse(contents));
  } catch {
    throw new Error(`invalid JSON in ${authPath}`);
  }
}

export async function fetchOpenCodeUsage(
  apiKey: string,
  fetchUsage: FetchUsage = fetch,
): Promise<UsageLimit[]> {
  const response = await fetchUsage(OPENCODE_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "User-Agent": "pi-status",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const payload = await response.json();
  if (!isObject(payload) || !isObject(payload.usage)) {
    throw new Error("invalid usage response");
  }

  return [
    parseWindow(payload.usage.rolling, "5-hour"),
    parseWindow(payload.usage.weekly, "Weekly"),
    parseWindow(payload.usage.monthly, "Monthly"),
  ].filter((limit): limit is UsageLimit => limit !== null);
}

export const openCodeAdapter: UsageProviderAdapter = {
  providerIds: OPENCODE_PROVIDER_IDS,
  displayName: "OpenCode Go",
  async fetchUsage(ctx: ExtensionCommandContext) {
    const provider = ctx.model?.provider;
    if (!provider || !OPENCODE_PROVIDER_IDS.some((providerId) => providerId === provider)) {
      throw new Error("OpenCode adapter used with an unsupported provider");
    }

    const token = (await ctx.modelRegistry.getApiKeyForProvider(provider)) || (await cliApiKey());
    if (!token) throw new Error("not logged in for OpenCode Go");
    return fetchOpenCodeUsage(token);
  },
};
