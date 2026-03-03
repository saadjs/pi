import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ProviderKey = "codex" | "claude" | "copilot";
export type OAuthProviderId = "openai-codex" | "anthropic" | "github-copilot";

export interface AuthData {
  "openai-codex"?: { access?: string; refresh?: string; expires?: number };
  anthropic?: { access?: string; refresh?: string; expires?: number };
  "github-copilot"?: {
    access?: string;
    refresh?: string;
    expires?: number;
    type?: string;
  };
}

export interface UsageData {
  session: number;
  weekly: number;
  sessionResetsIn?: string;
  weeklyResetsIn?: string;
  extraSpend?: number;
  extraLimit?: number;
  error?: string;
}

export type UsageByProvider = Record<ProviderKey, UsageData | null>;

export interface UsageEndpoints {}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<any>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponseLike>;

export interface RequestConfig {
  fetchFn?: FetchLike;
  timeoutMs?: number;
}

export interface OAuthApiKeyResult {
  newCredentials: Record<string, any>;
  apiKey: string;
}

export type OAuthApiKeyResolver = (
  providerId: OAuthProviderId,
  credentials: Record<string, Record<string, any>>,
) => Promise<OAuthApiKeyResult | null>;

export interface EnsureFreshAuthConfig {
  auth?: AuthData | null;
  authFile?: string;
  oauthResolver?: OAuthApiKeyResolver;
  nowMs?: number;
  persist?: boolean;
}

export interface FreshAuthResult {
  auth: AuthData | null;
  changed: boolean;
  refreshErrors: Partial<Record<OAuthProviderId, string>>;
}

const DEFAULT_FETCH_TIMEOUT_MS = 12_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;

export const DEFAULT_AUTH_FILE = path.join(os.homedir(), ".pi", "agent", "auth.json");

export function resolveUsageEndpoints(): UsageEndpoints {
  return {};
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "request timeout";
    return error.message || String(error);
  }
  return String(error);
}

function asObject(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, any>;
}

async function requestJson(
  url: string,
  init: RequestInit,
  config: RequestConfig = {},
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  const fetchFn = config.fetchFn ?? (fetch as unknown as FetchLike);
  const timeoutMs = config.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchFn(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };

    try {
      const data = await response.json();
      return { ok: true, data };
    } catch {
      return { ok: false, error: "invalid JSON response" };
    }
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0 && h > 0) return `${d}d ${h}h`;
  if (d > 0) return `${d}d`;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return "<1m";
}

export function formatResetsAt(isoDate: string, nowMs = Date.now()): string {
  const resetTime = new Date(isoDate).getTime();
  if (!Number.isFinite(resetTime)) return "";
  const diffSeconds = Math.max(0, (resetTime - nowMs) / 1000);
  return formatDuration(diffSeconds);
}

function nextUtcMonthBoundaryMs(nowMs = Date.now()): number {
  const now = new Date(nowMs);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return Date.UTC(y, m + 1, 1, 0, 0, 0, 0);
}

function copilotResetCountdown(data: any, nowMs = Date.now()): string {
  const fromApi =
    typeof data?.quota_reset_date === "string" ? formatResetsAt(data.quota_reset_date, nowMs) : "";
  if (fromApi) return fromApi;

  const nextBoundary = nextUtcMonthBoundaryMs(nowMs);
  const seconds = Math.max(0, (nextBoundary - nowMs) / 1000);
  return formatDuration(seconds);
}

export function readAuth(authFile = DEFAULT_AUTH_FILE): AuthData | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(authFile, "utf-8"));
    return asObject(parsed) as AuthData;
  } catch {
    return null;
  }
}

export function writeAuth(auth: AuthData, authFile = DEFAULT_AUTH_FILE): boolean {
  try {
    const dir = path.dirname(authFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmpPath = `${authFile}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(auth, null, 2));
    fs.renameSync(tmpPath, authFile);
    return true;
  } catch {
    return false;
  }
}

let cachedOAuthResolver: OAuthApiKeyResolver | null = null;

async function getDefaultOAuthResolver(): Promise<OAuthApiKeyResolver> {
  if (cachedOAuthResolver) return cachedOAuthResolver;

  const mod = await import("@mariozechner/pi-ai");
  if (typeof (mod as any).getOAuthApiKey !== "function") {
    throw new Error("oauth resolver unavailable");
  }

  cachedOAuthResolver = (providerId, credentials) =>
    (mod as any).getOAuthApiKey(providerId, credentials) as Promise<OAuthApiKeyResult | null>;

  return cachedOAuthResolver;
}

function isCredentialExpired(creds: { expires?: number } | undefined, nowMs: number): boolean {
  if (!creds) return false;
  if (typeof creds.expires !== "number") return false;
  return nowMs + TOKEN_REFRESH_SKEW_MS >= creds.expires;
}

export async function ensureFreshAuthForProviders(
  providerIds: OAuthProviderId[],
  config: EnsureFreshAuthConfig = {},
): Promise<FreshAuthResult> {
  const authFile = config.authFile ?? DEFAULT_AUTH_FILE;
  const auth = config.auth ?? readAuth(authFile);
  if (!auth) {
    return { auth: null, changed: false, refreshErrors: {} };
  }

  const nowMs = config.nowMs ?? Date.now();
  const uniqueProviders = Array.from(new Set(providerIds));
  const nextAuth: AuthData = { ...auth };
  const refreshErrors: Partial<Record<OAuthProviderId, string>> = {};

  let changed = false;

  for (const providerId of uniqueProviders) {
    const creds = (nextAuth as any)[providerId] as
      | { access?: string; refresh?: string; expires?: number }
      | undefined;
    if (!creds?.refresh) continue;

    const needsRefresh = !creds.access || isCredentialExpired(creds, nowMs);
    if (!needsRefresh) continue;

    try {
      const resolver = config.oauthResolver ?? (await getDefaultOAuthResolver());
      const resolved = await resolver(providerId, nextAuth as any);
      if (!resolved?.newCredentials) {
        refreshErrors[providerId] = "missing OAuth credentials";
        continue;
      }

      (nextAuth as any)[providerId] = {
        ...(nextAuth as any)[providerId],
        ...resolved.newCredentials,
      };
      changed = true;
    } catch (error) {
      refreshErrors[providerId] = toErrorMessage(error);
    }
  }

  if (changed && config.persist !== false) {
    writeAuth(nextAuth, authFile);
  }

  return { auth: nextAuth, changed, refreshErrors };
}

export function readPercentCandidate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  if (value >= 0 && value <= 1) {
    if (Number.isInteger(value)) return value;
    return value * 100;
  }

  if (value >= 0 && value <= 100) return value;
  return null;
}

function readCopilotNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readCopilotPercent(snapshot: any): number | null {
  const direct = readCopilotNumber(snapshot?.percent_remaining);
  if (direct != null) return Math.max(0, Math.min(100, direct));

  const entitlement = readCopilotNumber(snapshot?.entitlement);
  const remaining = readCopilotNumber(snapshot?.remaining);
  if (entitlement != null && entitlement > 0 && remaining != null) {
    const pct = (remaining / entitlement) * 100;
    return Math.max(0, Math.min(100, pct));
  }

  return null;
}

function getCopilotSnapshot(data: any, key: string): any | null {
  const fromQuotaSnapshots = data?.quota_snapshots?.[key];
  if (fromQuotaSnapshots && typeof fromQuotaSnapshots === "object") return fromQuotaSnapshots;

  if (key === "premium_interactions") {
    const monthly = readCopilotNumber(data?.monthly_quotas?.completions);
    const limited = readCopilotNumber(data?.limited_user_quotas?.completions);
    if (monthly != null || limited != null) {
      return { entitlement: monthly, remaining: limited };
    }
  }

  if (key === "chat") {
    const monthly = readCopilotNumber(data?.monthly_quotas?.chat);
    const limited = readCopilotNumber(data?.limited_user_quotas?.chat);
    if (monthly != null || limited != null) {
      return { entitlement: monthly, remaining: limited };
    }
  }

  return null;
}

export async function fetchCodexUsage(
  token: string,
  config: RequestConfig = {},
): Promise<UsageData> {
  const result = await requestJson(
    "https://chatgpt.com/backend-api/wham/usage",
    { headers: { Authorization: `Bearer ${token}` } },
    config,
  );

  if (!result.ok) return { session: 0, weekly: 0, error: result.error };

  const primary = result.data?.rate_limit?.primary_window;
  const secondary = result.data?.rate_limit?.secondary_window;

  return {
    session: readPercentCandidate(primary?.used_percent) ?? 0,
    weekly: readPercentCandidate(secondary?.used_percent) ?? 0,
    sessionResetsIn:
      typeof primary?.reset_after_seconds === "number"
        ? formatDuration(primary.reset_after_seconds)
        : undefined,
    weeklyResetsIn:
      typeof secondary?.reset_after_seconds === "number"
        ? formatDuration(secondary.reset_after_seconds)
        : undefined,
  };
}

export async function fetchClaudeUsage(
  token: string,
  config: RequestConfig = {},
): Promise<UsageData> {
  const result = await requestJson(
    "https://api.anthropic.com/api/oauth/usage",
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
    },
    config,
  );

  if (!result.ok) return { session: 0, weekly: 0, error: result.error };

  const data = result.data;
  const weeklyWindow =
    data?.seven_day || data?.seven_day_sonnet || data?.seven_day_opus || data?.seven_day_oauth_apps;

  const usage: UsageData = {
    session: readPercentCandidate(data?.five_hour?.utilization) ?? 0,
    weekly: readPercentCandidate(weeklyWindow?.utilization) ?? 0,
    sessionResetsIn: data?.five_hour?.resets_at
      ? formatResetsAt(data.five_hour.resets_at)
      : undefined,
    weeklyResetsIn: weeklyWindow?.resets_at ? formatResetsAt(weeklyWindow.resets_at) : undefined,
  };

  if (data?.extra_usage?.is_enabled) {
    usage.extraSpend =
      typeof data.extra_usage.used_credits === "number" ? data.extra_usage.used_credits : undefined;
    usage.extraLimit =
      typeof data.extra_usage.monthly_limit === "number"
        ? data.extra_usage.monthly_limit
        : undefined;
  }

  return usage;
}

export async function fetchCopilotUsage(
  token: string,
  config: RequestConfig = {},
): Promise<UsageData> {
  const result = await requestJson(
    "https://api.github.com/copilot_internal/user",
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/json",
        "Editor-Version": "vscode/1.107.0",
        "Editor-Plugin-Version": "copilot-chat/0.35.0",
        "User-Agent": "GitHubCopilotChat/0.35.0",
        "Copilot-Integration-Id": "vscode-chat",
        "X-Github-Api-Version": "2025-04-01",
      },
    },
    config,
  );

  if (!result.ok) return { session: 0, weekly: 0, error: result.error };

  const data = result.data;
  const premium = getCopilotSnapshot(data, "premium_interactions");
  const chat = getCopilotSnapshot(data, "chat");

  const premiumRemaining = readCopilotPercent(premium);
  const chatRemaining = readCopilotPercent(chat);

  if (premiumRemaining == null && chatRemaining == null) {
    return { session: 0, weekly: 0, error: "unrecognized response shape" };
  }

  const sessionUsed = premiumRemaining != null ? 100 - premiumRemaining : 0;
  const weeklyUsed = chatRemaining != null ? 100 - chatRemaining : sessionUsed;
  const resetIn = copilotResetCountdown(data);

  return {
    session: Math.max(0, Math.min(100, sessionUsed)),
    weekly: Math.max(0, Math.min(100, weeklyUsed)),
    sessionResetsIn: resetIn,
    weeklyResetsIn: resetIn,
  };
}

export function detectProvider(
  model:
    | { provider?: string; id?: string; name?: string; api?: string }
    | string
    | undefined
    | null,
): ProviderKey | null {
  if (!model || typeof model === "string") return null;

  const provider = (model.provider || "").toLowerCase();
  if (provider === "openai-codex") return "codex";
  if (provider === "anthropic") return "claude";
  if (provider === "github-copilot") return "copilot";

  return null;
}

export function providerToOAuthProviderId(active: ProviderKey | null): OAuthProviderId | null {
  if (active === "codex") return "openai-codex";
  if (active === "claude") return "anthropic";
  if (active === "copilot") return "github-copilot";
  return null;
}

export function canShowForProvider(
  active: ProviderKey | null,
  auth: AuthData | null,
  _endpoints: UsageEndpoints,
): boolean {
  if (!active || !auth) return false;
  if (active === "codex") return !!(auth["openai-codex"]?.access || auth["openai-codex"]?.refresh);
  if (active === "claude") return !!(auth.anthropic?.access || auth.anthropic?.refresh);
  if (active === "copilot")
    return !!(auth["github-copilot"]?.access || auth["github-copilot"]?.refresh);
  return false;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function colorForPercent(value: number): "success" | "warning" | "error" {
  if (value >= 90) return "error";
  if (value >= 70) return "warning";
  return "success";
}
