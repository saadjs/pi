import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { HttpError, isObject, numberAtLeast, type FetchUsage, type UsageLimit } from "../core.ts";
import type { UsageProviderAdapter } from "./types";

const CLAUDE_API_URL = "https://api.anthropic.com/api/oauth";

function parseWindow(value: unknown, label: string): UsageLimit | null {
  if (!isObject(value)) return null;

  const utilization = numberAtLeast(value.utilization, 0);
  if (utilization === undefined) return null;

  let resetsAt: number | undefined;
  if (typeof value.resets_at === "string") {
    const milliseconds = Date.parse(value.resets_at);
    if (Number.isFinite(milliseconds)) resetsAt = milliseconds / 1000;
  }

  // Over-quota may exceed 100; clamp so a full bar shows instead of the window vanishing.
  return { label, usedPercent: Math.min(utilization, 100), resetsAt };
}

async function requestJson(
  path: string,
  token: string,
  fetchUsage: FetchUsage,
): Promise<Record<string, unknown>> {
  const response = await fetchUsage(`${CLAUDE_API_URL}/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Claude login expired; run /login anthropic");
    }
    throw new HttpError(response.status);
  }

  const payload = await response.json();
  if (!isObject(payload)) throw new Error(`invalid ${path} response`);
  return payload;
}

/** The Claude subscription's 5-hour session and weekly limits. */
export async function fetchClaudeUsage(
  token: string,
  fetchUsage: FetchUsage = fetch,
): Promise<UsageLimit[]> {
  const payload = await requestJson("usage", token, fetchUsage);
  return [
    parseWindow(payload.five_hour, "5-hour"),
    parseWindow(payload.seven_day, "Weekly"),
    parseWindow(payload.seven_day_opus, "Weekly Opus"),
    parseWindow(payload.seven_day_sonnet, "Weekly Sonnet"),
  ].filter((limit): limit is UsageLimit => limit !== null);
}

function planName(account: Record<string, unknown>, organization: unknown): string | undefined {
  const type = isObject(organization) ? organization.organization_type : undefined;
  if (typeof type === "string" && type.startsWith("claude_")) {
    const plan = type.slice("claude_".length);
    return plan.charAt(0).toUpperCase() + plan.slice(1);
  }
  if (account.has_claude_max === true) return "Max";
  if (account.has_claude_pro === true) return "Pro";
  return undefined;
}

/** The signed-in Claude account's email and plan, e.g. `me@example.com (Pro)`. */
export async function fetchClaudeAccount(
  token: string,
  fetchUsage: FetchUsage = fetch,
): Promise<string> {
  const payload = await requestJson("profile", token, fetchUsage);
  const account = payload.account;
  if (!isObject(account) || typeof account.email !== "string" || !account.email.trim()) {
    throw new Error("invalid profile response");
  }

  const plan = planName(account, payload.organization);
  return plan ? `${account.email.trim()} (${plan})` : account.email.trim();
}

async function claudeToken(ctx: ExtensionCommandContext): Promise<string> {
  const token = await ctx.modelRegistry.getApiKeyForProvider("anthropic");
  if (!token) throw new Error("not logged in for Claude");
  return token;
}

export const claudeAdapter: UsageProviderAdapter = {
  providerIds: ["anthropic"],
  displayName: "Claude",
  // Only Claude Pro/Max sign-ins have subscription usage; API keys do not.
  supports: (ctx: ExtensionCommandContext) =>
    ctx.model !== undefined && ctx.modelRegistry.isUsingOAuth(ctx.model),
  async fetchUsage(ctx) {
    return fetchClaudeUsage(await claudeToken(ctx));
  },
  async fetchAccount(ctx) {
    return fetchClaudeAccount(await claudeToken(ctx));
  },
};
