import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { it } from "node:test";
import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
  ExtensionHandler,
  SessionShutdownEvent,
  SessionStartEvent,
  Theme,
  ToolResultEvent,
  ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";

type Handlers = {
  session_start: ExtensionHandler<SessionStartEvent>;
  session_shutdown: ExtensionHandler<SessionShutdownEvent>;
  agent_end: ExtensionHandler<AgentEndEvent>;
  tool_result: ExtensionHandler<ToolResultEvent, ToolResultEventResult>;
};

type Registration = {
  [K in keyof Handlers]: [name: K, handler: Handlers[K]];
}[keyof Handlers];

function harness(cwd: string, mode: ExtensionContext["mode"] = "tui") {
  const handlers: Partial<Handlers> = {};
  const updates: (string | undefined)[] = [];
  const theme = {
    fg: (_color: string, text: string) => text,
  } satisfies Pick<Theme, "fg">;
  const mockContext = {
    cwd,
    mode,
    hasUI: mode === "tui" || mode === "rpc",
    ui: {
      theme,
      setStatus: (key: string, text: string | undefined) => {
        assert.equal(key, "git-status");
        updates.push(text);
      },
    },
  } satisfies Pick<ExtensionContext, "cwd" | "mode" | "hasUI"> & {
    ui: Pick<ExtensionContext["ui"], "setStatus"> & { theme: Pick<Theme, "fg"> };
  };
  // SAFETY: The extension uses only cwd, mode, hasUI, ui.setStatus, and ui.theme.fg; all are typed above.
  const ctx = mockContext as ExtensionContext;
  const mockAPI = {
    on(...[name, handler]: Registration) {
      switch (name) {
        case "session_start":
          handlers.session_start = handler;
          break;
        case "session_shutdown":
          handlers.session_shutdown = handler;
          break;
        case "agent_end":
          handlers.agent_end = handler;
          break;
        case "tool_result":
          handlers.tool_result = handler;
          break;
      }
      return () => {
        delete handlers[name];
      };
    },
  };
  // SAFETY: The extension only calls on for the four events whose handler signatures are typed above.
  extension(mockAPI as ExtensionAPI);
  return {
    theme,
    updates,
    start: () => handlers.session_start?.({ type: "session_start", reason: "startup" }, ctx),
    shutdown: () => handlers.session_shutdown?.({ type: "session_shutdown", reason: "quit" }, ctx),
    agentEnd: () => handlers.agent_end?.({ type: "agent_end", messages: [] }, ctx),
    toolResult: (toolName: string, isError = false) =>
      handlers.tool_result?.(
        {
          type: "tool_result",
          toolCallId: "test-call",
          toolName,
          input: {},
          content: [],
          details: undefined,
          isError,
        },
        ctx,
      ),
  };
}

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await delay(10);
  }
  assert.fail("Timed out waiting for footer update");
}

it("refreshes only on Pi events, avoids redundant renders, and cleans up", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-git-footer-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  execFileSync("git", ["init", "--initial-branch=main"], { cwd, stdio: "ignore" });
  const h = harness(cwd);
  t.after(() => h.shutdown());
  h.start();
  await waitFor(() => h.updates.at(-1) === "main • clean");

  for (let i = 0; i < 10; i++) {
    h.toolResult("edit");
  }
  await delay(250);
  assert.equal(h.updates.length, 1, "unchanged status should not redraw");

  writeFileSync(join(cwd, "new"), "untracked\n");
  for (const toolName of ["read", "ls", "grep", "find", "bash", "powershell", "custom"]) {
    h.toolResult(toolName);
  }
  for (const toolName of ["edit", "write"]) {
    h.toolResult(toolName, true);
  }
  await delay(250);
  assert.equal(h.updates.length, 1, "irrelevant or failed tools must not refresh");

  h.toolResult("write");
  await waitFor(() => h.updates.at(-1)?.includes("1 untracked") === true);

  writeFileSync(join(cwd, "second"), "untracked\n");
  h.toolResult("edit");
  await waitFor(() => h.updates.at(-1)?.includes("2 untracked") === true);

  // Idle sessions must not poll for external changes.
  const countBeforeExternalEdit = h.updates.length;
  writeFileSync(join(cwd, "third"), "untracked\n");
  await delay(2_100);
  assert.equal(h.updates.length, countBeforeExternalEdit, "idle sessions must not refresh");
  assert.match(h.updates.at(-1)!, /2 untracked/);

  h.agentEnd();
  await waitFor(() => h.updates.at(-1)?.includes("3 untracked") === true);

  // Replacing a session should stop its monitor and initialize just one new monitor.
  h.start();
  await waitFor(() => h.updates.at(-1)?.includes("3 untracked") === true);
  // Leave a debounce pending when shutdown occurs.
  h.toolResult("edit");
  h.shutdown();
  h.shutdown();
  const count = h.updates.length;
  assert.equal(h.updates.at(-1), undefined);
  writeFileSync(join(cwd, "fourth"), "untracked\n");
  await delay(250);
  assert.equal(h.updates.length, count, "shutdown must cancel pending updates");
});

it("uses the current theme on normal refreshes and session restarts", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-git-theme-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  execFileSync("git", ["init", "--initial-branch=main"], { cwd, stdio: "ignore" });
  const h = harness(cwd);
  t.after(() => h.shutdown());
  h.theme.fg = (color, text) => `<blue:${color}>${text}</blue:${color}>`;
  h.start();
  await waitFor(
    () =>
      h.updates.at(-1) ===
      "<blue:text>main</blue:text><blue:muted> • </blue:muted><blue:success>clean</blue:success>",
  );

  h.theme.fg = (color, text) => `<green:${color}>${text}</green:${color}>`;
  const count = h.updates.length;
  await delay(1_100);
  assert.equal(h.updates.length, count, "theme changes alone must not refresh the status");

  writeFileSync(join(cwd, "new"), "untracked\n");
  h.agentEnd();
  await waitFor(
    () =>
      h.updates.at(-1) ===
      "<green:text>main</green:text><green:muted> • </green:muted>" +
        "<green:muted>0 changed</green:muted><green:muted> • </green:muted>" +
        "<green:muted>1 untracked</green:muted><green:muted> • </green:muted>" +
        "<green:muted>+0</green:muted> <green:muted>−0</green:muted>",
  );

  h.shutdown();
  h.theme.fg = (color, text) => `<red:${color}>${text}</red:${color}>`;
  h.start();
  await waitFor(
    () =>
      h.updates.at(-1) ===
      "<red:text>main</red:text><red:muted> • </red:muted>" +
        "<red:muted>0 changed</red:muted><red:muted> • </red:muted>" +
        "<red:muted>1 untracked</red:muted><red:muted> • </red:muted>" +
        "<red:muted>+0</red:muted> <red:muted>−0</red:muted>",
  );
});

it("does not run footer monitoring in print, JSON, or RPC modes", async () => {
  for (const mode of ["print", "json", "rpc"] as const) {
    const h = harness("/does/not/exist", mode);
    h.start();
    h.toolResult("write");
    h.agentEnd();
    h.shutdown();
    assert.deepEqual(h.updates, []);
  }
});

it("does not publish an in-flight result after immediate shutdown", async () => {
  const h = harness(process.cwd());
  h.start();
  h.shutdown();
  await delay(100);
  assert.deepEqual(h.updates, [undefined]);
});
