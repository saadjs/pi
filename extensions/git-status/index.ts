import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatGitStatus, readGitStatus } from "./core.ts";

const STATUS_KEY = "git-status";
const DEBOUNCE_MS = 150;

export default function (pi: ExtensionAPI) {
  let stop: (() => void) | undefined;
  let requestRefresh: ((ctx: ExtensionContext) => void) | undefined;

  pi.on("session_start", (_event, ctx) => {
    stop?.();
    stop = undefined;
    requestRefresh = undefined;
    if (ctx.mode !== "tui" || !ctx.hasUI) return;

    let context = ctx;
    let disposed = false;
    let busy = false;
    let pending = false;
    let lastText: string | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function refresh() {
      if (disposed) return;
      if (busy) {
        pending = true;
        return;
      }
      busy = true;
      const current = context;
      try {
        const status = await readGitStatus(current.cwd, controller.signal);
        if (disposed) return;
        const text = status
          ? formatGitStatus(status, (name, value) => current.ui.theme.fg(name, value))
          : undefined;
        if (text !== lastText) {
          current.ui.setStatus(STATUS_KEY, text);
          lastText = text;
        }
      } finally {
        busy = false;
        if (pending && !disposed) {
          pending = false;
          void refresh();
        }
      }
    }

    requestRefresh = (nextContext) => {
      context = nextContext;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = undefined;
        void refresh();
      }, DEBOUNCE_MS);
      debounce.unref();
    };

    stop = () => {
      if (disposed) return;
      disposed = true;
      if (debounce) clearTimeout(debounce);
      controller.abort();
      context.ui.setStatus(STATUS_KEY, undefined);
    };
    void refresh();
  });

  // Refresh after successful file mutations, not read-only tools or every shell call.
  pi.on("tool_result", (event, ctx) => {
    if (!event.isError && (event.toolName === "edit" || event.toolName === "write")) {
      requestRefresh?.(ctx);
    }
  });
  // Catch shell-made changes once the agent finishes.
  pi.on("agent_end", (_event, ctx) => requestRefresh?.(ctx));

  pi.on("session_shutdown", () => {
    stop?.();
    stop = undefined;
    requestRefresh = undefined;
  });
}
