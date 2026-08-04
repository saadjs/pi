/** On-demand ChatGPT Codex usage for pi. */

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { fetchCodexUsage, type UsageLimit } from "./core";

const resetTimeFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

function formatPercent(value: number): string {
  return `${value.toFixed(3).replace(/\.?(0+)$/, "")}%`;
}

function formatLine(theme: Theme, label: string, value: string, labelWidth: number): string {
  return theme.fg("muted", `${label}:`.padEnd(labelWidth + 2)) + value;
}

export default function (pi: ExtensionAPI) {
  async function showStatus(ctx: ExtensionCommandContext) {
    if (!ctx.hasUI) return;

    const theme = ctx.ui.theme;
    const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "n/a";
    if (ctx.model?.provider !== "openai-codex") {
      const width = "Provider".length;
      ctx.ui.notify(
        [
          formatLine(theme, "CWD", ctx.cwd, width),
          formatLine(theme, "Model", model, width),
          formatLine(theme, "Provider", "unsupported", width),
        ].join("\n"),
        "warning",
      );
      return;
    }

    let usage: UsageLimit[] | string;
    try {
      const token = await ctx.modelRegistry.getApiKeyForProvider("openai-codex");
      usage = token ? await fetchCodexUsage(token) : "not logged in for Codex";
    } catch (error) {
      usage = error instanceof Error ? error.message : String(error);
    }

    const limits = typeof usage === "string" ? [] : usage;
    const labelWidth = Math.max(
      ...["CWD", "Model", "Provider", "Limits", ...limits.map(({ label }) => label)].map(
        (label) => label.length,
      ),
    );
    const percentWidth = Math.max(
      0,
      ...limits.map(({ usedPercent }) => formatPercent(usedPercent).length),
    );
    const lines = [
      formatLine(theme, "CWD", ctx.cwd, labelWidth),
      formatLine(theme, "Model", model, labelWidth),
      formatLine(theme, "Provider", "Codex", labelWidth),
    ];

    if (typeof usage === "string") {
      lines.push(formatLine(theme, "Limits", `unavailable (${usage})`, labelWidth));
    } else if (usage.length === 0) {
      lines.push(formatLine(theme, "Limits", "none reported", labelWidth));
    } else {
      for (const limit of usage) {
        const filled = Math.round((limit.usedPercent / 100) * 12);
        const color =
          limit.usedPercent >= 90 ? "error" : limit.usedPercent >= 70 ? "warning" : "success";
        const bar = theme.fg(color, "█".repeat(filled)) + theme.fg("dim", "░".repeat(12 - filled));
        const resetTime =
          limit.resetsAt === undefined ? "" : resetTimeFormat.format(limit.resetsAt * 1000);
        const reset = [limit.resetsIn ? `in ${limit.resetsIn}` : "", resetTime]
          .filter(Boolean)
          .join(" · ");
        const percent = theme.fg(color, formatPercent(limit.usedPercent).padStart(percentWidth));
        const details = reset ? theme.fg("dim", ` (resets ${reset})`) : "";
        lines.push(formatLine(theme, limit.label, `${bar} ${percent}${details}`, labelWidth));
      }
    }

    ctx.ui.notify(lines.join("\n"), "info");
  }

  pi.registerCommand("status", {
    description: "Show Codex usage status",
    handler: (_args, ctx) => showStatus(ctx),
  });

  pi.registerCommand("usage", {
    description: "Alias for /status",
    handler: (_args, ctx) => showStatus(ctx),
  });
}
