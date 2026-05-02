import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ProviderKey = "codex";
export type OAuthProviderId = "openai-codex";

export interface AuthData {
  "openai-codex"?: { access?: string; refresh?: string; expires?: number };
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

  return null;
}

export function providerToOAuthProviderId(active: ProviderKey | null): OAuthProviderId | null {
  if (active === "codex") return "openai-codex";
  return null;
}

export function canShowForProvider(
  active: ProviderKey | null,
  auth: AuthData | null,
  _endpoints: UsageEndpoints,
): boolean {
  if (!active || !auth) return false;
  if (active === "codex") return !!(auth["openai-codex"]?.access || auth["openai-codex"]?.refresh);
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
