import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatPreview, isGhostty, notificationSequence, notificationTitle } from "./core.ts";

const TEST_DELAY_MS = 5_000;

type NotificationDependencies = {
  env?: NodeJS.ProcessEnv;
  write?: (sequence: string) => void;
};

/** Dependencies are injectable so tests never send real desktop notifications. */
export function registerNotifications(
  pi: ExtensionAPI,
  dependencies: NotificationDependencies = {},
) {
  const env = dependencies.env ?? process.env;
  const write = dependencies.write ?? ((sequence: string) => process.stdout.write(sequence));
  let active = false;
  let ready = false;
  let preview = "";
  let outcome: "completed" | "aborted" | "error" | undefined;
  let signal: AbortSignal | undefined;
  let testTimer: ReturnType<typeof setTimeout> | undefined;

  function supported(ctx: ExtensionContext): boolean {
    return ctx.mode === "tui" && ctx.hasUI && isGhostty(env) && !env.TMUX;
  }

  function reset() {
    active = false;
    ready = false;
    preview = "";
    outcome = undefined;
    signal = undefined;
    if (testTimer) clearTimeout(testTimer);
    testTimer = undefined;
  }

  function notify(ctx: ExtensionContext, body: string) {
    // Ghostty suppresses the banner AND sound for the focused terminal surface.
    write(notificationSequence(notificationTitle(ctx.cwd, pi.getSessionName()), body));
  }

  pi.on("session_start", reset);
  pi.on("session_shutdown", reset);

  pi.on("agent_start", (_event, ctx) => {
    // Also clears eligibility when a retry or boundary continuation starts.
    active = supported(ctx);
    ready = false;
    outcome = undefined;
    preview = "";
    signal = ctx.signal;
  });

  pi.on("message_end", (event) => {
    if (!active || event.message.role !== "assistant") return;
    const message = event.message;
    preview = formatPreview(
      message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"),
    );
    if (message.stopReason === "error") {
      preview = formatPreview(message.errorMessage ?? "") || "Pi stopped with an error.";
    }
  });

  pi.on("agent_before_settle", (event) => {
    outcome = event.outcome;
    ready = active && outcome !== "aborted";
  });

  pi.on("agent_settled", (_event, ctx) => {
    const shouldNotify = active && ready && !signal?.aborted && supported(ctx);
    const body =
      preview || (outcome === "error" ? "Pi stopped with an error." : "Finished. Ready for input.");
    // Clear first: duplicate settlement events must not produce duplicate notifications.
    active = false;
    ready = false;
    preview = "";
    outcome = undefined;
    signal = undefined;
    // Cancellation can bypass agent_before_settle entirely; ready stays false.
    if (shouldNotify) notify(ctx, body);
  });

  pi.registerCommand("notify", {
    description: "Test desktop notifications: /notify test (fires in 5 seconds)",
    handler: async (args, ctx) => {
      if (args.trim() !== "test") {
        ctx.ui.notify("Usage: /notify test", "info");
        return;
      }
      if (!supported(ctx)) {
        ctx.ui.notify(
          "Notifications require an interactive Pi session directly in Ghostty (no tmux).",
          "warning",
        );
        return;
      }
      if (testTimer) clearTimeout(testTimer);
      ctx.ui.notify(
        "Test notification in 5 seconds. Switch to another tab, pane, window, or app.",
        "info",
      );
      testTimer = setTimeout(() => {
        testTimer = undefined;
        notify(ctx, "Notifications are working. Click to return to this Pi session.");
      }, TEST_DELAY_MS);
      testTimer.unref();
    },
  });
}

export default function (pi: ExtensionAPI) {
  registerNotifications(pi);
}
