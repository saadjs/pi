import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  formatGitStatus,
  readGitStatus,
  readPullRequest,
  type GitStatus,
  type PullRequest,
} from "./core.ts";

const STATUS_KEY = "git-status";
const DEBOUNCE_MS = 150;
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
// Same cadence as Claude Code's PR footer: slow down as the user goes idle, stop after an hour.
const PR_IDLE_STOP_MS = 60 * MINUTE;
const PR_SKIP_BRANCHES = new Set(["detached", "main", "master"]);
const PR_COMMAND = /\b(?:git\s+(?:push|checkout|switch)|gh\s+pr)\b/;

function idleInterval(idle: number) {
  if (idle < 30 * SECOND) return 90 * SECOND;
  if (idle < 5 * MINUTE) return 3 * MINUTE;
  if (idle < 30 * MINUTE) return 10 * MINUTE;
  return 30 * MINUTE;
}

/** Backoff after lookups that found no PR or failed. */
function missInterval(misses: number) {
  return [90 * SECOND, 5 * MINUTE, 15 * MINUTE][misses] ?? 30 * MINUTE;
}

export default function (pi: ExtensionAPI) {
  let stop: (() => void) | undefined;
  let requestRefresh: ((ctx: ExtensionContext, options?: { pr?: boolean }) => void) | undefined;
  let markActive: (() => void) | undefined;

  pi.on("session_start", (_event, ctx) => {
    stop?.();
    stop = undefined;
    requestRefresh = undefined;
    markActive = undefined;
    if (ctx.mode !== "tui" || !ctx.hasUI) return;

    let context = ctx;
    let disposed = false;
    let busy = false;
    let pending = false;
    let lastText: string | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    let git: GitStatus | null = null;
    let pr: PullRequest | null = null;
    let prBranch: string | undefined;
    let prUnavailable = false;
    let prBusy = false;
    let prPending = false;
    let prForced = false;
    let prTimer: ReturnType<typeof setTimeout> | undefined;
    let lastPrFetch = 0;
    let prMisses = 0;
    let lastActivity = Date.now();

    function render() {
      const current = context;
      const text = git
        ? formatGitStatus(
            git,
            (name, value) => current.ui.theme.fg(name, value),
            prBranch === git.branch ? pr : null,
          )
        : undefined;
      if (text !== lastText) {
        current.ui.setStatus(STATUS_KEY, text);
        lastText = text;
      }
    }

    function prEligible() {
      return !disposed && !prUnavailable && git !== null && !PR_SKIP_BRANCHES.has(git.branch);
    }

    function schedulePr() {
      if (prTimer) clearTimeout(prTimer);
      prTimer = undefined;
      if (!prEligible()) return;
      const now = Date.now();
      if (now - lastActivity >= PR_IDLE_STOP_MS) return;
      const interval = Math.max(idleInterval(now - lastActivity), missInterval(prMisses));
      prTimer = setTimeout(
        () => {
          prTimer = undefined;
          if (Date.now() - lastActivity < PR_IDLE_STOP_MS) void fetchPr();
        },
        Math.max(0, lastPrFetch + interval - now),
      );
      prTimer.unref();
    }

    async function fetchPr() {
      if (!prEligible()) return;
      if (prBusy) {
        prPending = true;
        return;
      }
      if (prTimer) clearTimeout(prTimer);
      prTimer = undefined;
      prBusy = true;
      const branch = git!.branch;
      try {
        const result = await readPullRequest(context.cwd, controller.signal).catch(
          () => "error" as const,
        );
        if (disposed || git?.branch !== branch) return;
        lastPrFetch = Date.now();
        if (result === "unavailable") {
          prUnavailable = true;
          pr = null;
        } else if (result === "error") {
          prMisses++;
        } else {
          pr = result;
          prMisses = result ? 0 : prMisses + 1;
        }
        render();
      } finally {
        prBusy = false;
        if (prPending && !disposed) {
          prPending = false;
          void fetchPr();
        } else {
          schedulePr();
        }
      }
    }

    async function refresh() {
      if (disposed) return;
      if (busy) {
        pending = true;
        return;
      }
      busy = true;
      try {
        const status = await readGitStatus(context.cwd, controller.signal);
        if (disposed) return;
        git = status;
        let fetch = prForced;
        prForced = false;
        if (status && status.branch !== prBranch) {
          prBranch = status.branch;
          pr = null;
          prMisses = 0;
          fetch = true;
        }
        render();
        if (fetch) void fetchPr();
        else if (!status && prTimer) {
          clearTimeout(prTimer);
          prTimer = undefined;
        }
      } finally {
        busy = false;
        if (pending && !disposed) {
          pending = false;
          void refresh();
        }
      }
    }

    requestRefresh = (nextContext, options) => {
      context = nextContext;
      if (options?.pr) {
        prForced = true;
        prMisses = 0;
      }
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = undefined;
        void refresh();
      }, DEBOUNCE_MS);
      debounce.unref();
    };

    markActive = () => {
      const wasIdle = Date.now() - lastActivity >= PR_IDLE_STOP_MS;
      lastActivity = Date.now();
      // Polling stops after an hour idle; resume it, fetching right away if overdue.
      if (wasIdle || (!prTimer && !prBusy)) schedulePr();
    };

    stop = () => {
      if (disposed) return;
      disposed = true;
      if (debounce) clearTimeout(debounce);
      if (prTimer) clearTimeout(prTimer);
      controller.abort();
      context.ui.setStatus(STATUS_KEY, undefined);
    };
    void refresh();
  });

  pi.on("input", () => {
    markActive?.();
  });

  pi.on("tool_result", (event, ctx) => {
    markActive?.();
    if (event.isError) return;
    // Refresh after successful file mutations, not read-only tools or every shell call.
    if (event.toolName === "edit" || event.toolName === "write") requestRefresh?.(ctx);
    // Pushes, checkouts, and gh pr commands can create a PR or change its state.
    const command = (event.input as { command?: unknown }).command;
    if (event.toolName === "bash" && typeof command === "string" && PR_COMMAND.test(command)) {
      requestRefresh?.(ctx, { pr: true });
    }
  });
  // Catch shell-made changes once the agent finishes.
  pi.on("agent_end", (_event, ctx) => {
    markActive?.();
    requestRefresh?.(ctx);
  });

  pi.on("session_shutdown", () => {
    stop?.();
    stop = undefined;
    requestRefresh = undefined;
    markActive = undefined;
  });
}
