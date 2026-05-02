/**
 * Usage Extension - /status command for pi
 *
 * Shows usage in an on-demand /status command for the active model provider.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  canShowForProvider,
  colorForPercent,
  detectProvider,
  fetchCodexUsage,
  ensureFreshAuthForProviders,
  providerToOAuthProviderId,
  readAuth,
  resolveUsageEndpoints,
  type ProviderKey,
  type UsageByProvider,
  type UsageData,
} from "./core";

const POLL_INTERVAL_MS = 2 * 60 * 1000;

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  codex: "Codex",
};

interface UsageState extends UsageByProvider {
  lastPoll: number;
  activeProvider: ProviderKey | null;
}

function formatModel(modelLike: any): string {
  if (!modelLike || typeof modelLike !== "object") return "n/a";

  const provider = typeof modelLike.provider === "string" ? modelLike.provider : "";
  const id = typeof modelLike.id === "string" ? modelLike.id : "";
  const name = typeof modelLike.name === "string" ? modelLike.name : "";

  if (provider && id) return `${provider}/${id}`;
  if (name) return name;
  if (id) return id;
  if (provider) return provider;
  return "n/a";
}

function clampPercentPrecise(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatPercent(value: number): string {
  const p = clampPercentPrecise(value);
  const fixed = p.toFixed(3).replace(/\.?(0+)$/, "");
  return `${fixed}%`;
}

function renderBar(theme: any, value: number, width = 12): string {
  const v = clampPercentPrecise(value);
  const filled = Math.round((v / 100) * width);
  const full = "█".repeat(Math.max(0, Math.min(width, filled)));
  const empty = "░".repeat(Math.max(0, width - filled));
  return theme.fg(colorForPercent(v), full) + theme.fg("dim", empty);
}

function formatLimitLine(theme: any, name: string, percent: number, reset?: string): string {
  const p = clampPercentPrecise(percent);
  const resetText = reset ? theme.fg("dim", ` (resets in ${reset})`) : "";
  return (
    theme.fg("muted", `${name.padEnd(7)} `) +
    renderBar(theme, p) +
    " " +
    theme.fg(colorForPercent(p), formatPercent(p).padStart(8)) +
    resetText
  );
}

export default function (pi: ExtensionAPI) {
  const endpoints = resolveUsageEndpoints();

  const state: UsageState = {
    codex: null,
    lastPoll: 0,
    activeProvider: null,
  };

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollInFlight: Promise<void> | null = null;
  let pollQueued = false;

  function pickDataForProvider(provider: ProviderKey | null): UsageData | null {
    if (!provider) return null;
    return state[provider];
  }

  function publishUsageUpdate() {
    const data = pickDataForProvider(state.activeProvider);
    if (!data || data.error) return;

    pi.events.emit("usage:update", {
      session: data.session,
      weekly: data.weekly,
      sessionResetsIn: data.sessionResetsIn,
      weeklyResetsIn: data.weeklyResetsIn,
    });
  }

  function updateProviderFrom(modelLike: any): boolean {
    const previous = state.activeProvider;
    state.activeProvider = detectProvider(modelLike);

    if (previous !== state.activeProvider) {
      publishUsageUpdate();
      return true;
    }

    return false;
  }

  async function runPoll() {
    let auth = readAuth();
    const active = state.activeProvider;

    const setActiveError = (message: string) => {
      if (!active) return;
      state[active] = { session: 0, weekly: 0, error: message };
    };

    if (!canShowForProvider(active, auth, endpoints)) {
      state.lastPoll = Date.now();
      publishUsageUpdate();
      return;
    }

    const oauthProviderId = providerToOAuthProviderId(active);
    if (oauthProviderId && auth) {
      const refreshed = await ensureFreshAuthForProviders([oauthProviderId], { auth });
      auth = refreshed.auth;

      const refreshError = refreshed.refreshErrors[oauthProviderId];
      if (refreshError) {
        setActiveError(`auth refresh failed (${refreshError})`);
        state.lastPoll = Date.now();
        publishUsageUpdate();
        return;
      }
    }

    if (!auth) {
      state.lastPoll = Date.now();
      publishUsageUpdate();
      return;
    }

    if (active === "codex") {
      const access = auth["openai-codex"]?.access;
      state.codex = access
        ? await fetchCodexUsage(access)
        : { session: 0, weekly: 0, error: "missing access token (try /login again)" };
    }

    state.lastPoll = Date.now();
    publishUsageUpdate();
  }

  async function poll() {
    if (pollInFlight) {
      pollQueued = true;
      await pollInFlight;
      return;
    }

    do {
      pollQueued = false;
      pollInFlight = runPoll()
        .catch(() => {
          // Never crash extension event handlers on transient polling errors.
        })
        .finally(() => {
          pollInFlight = null;
        });

      await pollInFlight;
    } while (pollQueued);
  }

  pi.on("session_start", async (_event, _ctx) => {
    updateProviderFrom(_ctx.model);
    await poll();

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
  });

  pi.on("session_shutdown", async () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });

  pi.on("turn_start", async (_event, _ctx) => {
    updateProviderFrom(_ctx.model);
  });

  pi.on("model_select", async (event, _ctx) => {
    const changed = updateProviderFrom(event.model ?? _ctx.model);
    if (changed) await poll();
  });

  async function handleStatus(_ctx: any) {
    updateProviderFrom(_ctx.model);
    await poll();

    if (!_ctx?.hasUI) return;

    const active = state.activeProvider;
    const model = formatModel(_ctx.model);
    const theme = _ctx.ui.theme;

    if (!active) {
      _ctx.ui.notify(`CWD: ${_ctx.cwd}\nModel: ${model}\nProvider: unsupported`, "warning");
      return;
    }

    const auth = readAuth();
    const providerLabel = PROVIDER_LABELS[active];
    const data = pickDataForProvider(active);

    const lines: string[] = [`CWD: ${_ctx.cwd}`, `Model: ${model}`, `Provider: ${providerLabel}`];

    if (!canShowForProvider(active, auth, endpoints)) {
      lines.push("Limits: unavailable (not logged in for active provider)");
    } else if (!data) {
      lines.push("Limits: unavailable (no usage data yet)");
    } else if (data.error) {
      lines.push(`Limits: unavailable (${data.error})`);
    } else {
      lines.push(formatLimitLine(theme, "Session", data.session, data.sessionResetsIn));
      lines.push(formatLimitLine(theme, "Weekly", data.weekly, data.weeklyResetsIn));

      if (typeof data.extraSpend === "number" && typeof data.extraLimit === "number") {
        lines.push(`Extra: $${data.extraSpend.toFixed(2)} / $${data.extraLimit}`);
      }
    }

    _ctx.ui.notify(lines.join("\n"), "info");
  }

  pi.registerCommand("status", {
    description: "Show usage status for active model provider",
    handler: async (_args, _ctx) => {
      await handleStatus(_ctx);
    },
  });

  pi.registerCommand("usage", {
    description: "Alias for /status",
    handler: async (_args, _ctx) => {
      await handleStatus(_ctx);
    },
  });
}
