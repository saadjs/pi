import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatPercent, getContextProgress } from "./core";

const STATUS_KEY = "context-usage";

function renderStatus(ctx: ExtensionContext): string {
  const theme = ctx.ui.theme;
  const progress = getContextProgress(ctx.getContextUsage());
  const bar =
    theme.fg(progress.color, "█".repeat(progress.filled)) +
    theme.fg("dim", "░".repeat(progress.empty));
  const percent = formatPercent(progress.percent);

  return `${theme.fg("muted", "ctx")} ${bar} ${theme.fg(
    progress.percent === null ? "dim" : progress.color,
    percent,
  )}`;
}

function updateStatus(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus(STATUS_KEY, renderStatus(ctx));
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("before_agent_start", (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("turn_end", (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("session_compact", (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
