import assert from "node:assert/strict";
import { it } from "node:test";
import type {
  AgentActivityOutcome,
  AgentBeforeSettleEvent,
  ExtensionAPI,
  ExtensionContext,
  ExtensionEvent,
  MessageEndEvent,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";
import { registerNotifications } from "../index.ts";

type Handler = (event: ExtensionEvent, ctx: ExtensionContext) => unknown;

function harness(
  options: {
    mode?: ExtensionContext["mode"];
    env?: NodeJS.ProcessEnv;
    hasUI?: boolean;
  } = {},
) {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
  const writes: string[] = [];
  const notices: string[] = [];
  const mode = options.mode ?? "tui";
  let sessionName: string | undefined;
  const controller = new AbortController();
  const mockContext = {
    cwd: "/tmp/app",
    mode,
    hasUI: options.hasUI ?? (mode === "tui" || mode === "rpc"),
    signal: controller.signal,
    ui: { notify: (message: string) => notices.push(message) },
  };
  // SAFETY: Only cwd, mode, hasUI, signal, and ui.notify are used by this extension.
  const ctx = mockContext as unknown as ExtensionContext;
  const api = {
    on: (name: string, handler: Handler) => {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
      commands.set(name, command);
    },
    getSessionName: () => sessionName,
  };
  // SAFETY: The harness implements every API method used by registerNotifications.
  registerNotifications(api as unknown as ExtensionAPI, {
    env: options.env ?? { TERM: "xterm-ghostty" },
    write: (sequence) => writes.push(sequence),
  });
  function emit(event: ExtensionEvent) {
    return handlers.get(event.type)?.(event, ctx);
  }
  return {
    writes,
    notices,
    controller,
    emit,
    setSessionName: (name: string) => {
      sessionName = name;
    },
    start: () => emit({ type: "agent_start" }),
    beforeSettle: (outcome: AgentActivityOutcome = "completed") =>
      emit({
        type: "agent_before_settle",
        entries: [],
        continue: false,
        outcome,
        context: {
          contextEntries: [],
          contextMessages: [],
          llmMessages: [],
          pendingMessages: [],
          canContinue: false,
        },
      } satisfies AgentBeforeSettleEvent),
    settle: () => emit({ type: "agent_settled" }),
    test: async (args = "test") => {
      // SAFETY: Command handler uses only the same minimal context, not command-only methods.
      await commands
        .get("notify")!
        .handler(args, ctx as Parameters<RegisteredCommand["handler"]>[1]);
    },
    shutdown: () => emit({ type: "session_shutdown", reason: "quit" }),
    sessionStart: () => emit({ type: "session_start", reason: "resume" }),
  };
}

function assistant(
  text: string,
  stopReason: "stop" | "toolUse" | "error" | "aborted" = "stop",
  errorMessage?: string,
): MessageEndEvent {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Private reasoning" },
        { type: "text", text },
      ],
      api: "openai-responses",
      provider: "openai",
      model: "test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason,
      errorMessage,
      timestamp: 0,
    },
  };
}

it("notifies once at final settlement, with only the latest assistant text", () => {
  const h = harness();
  h.start();
  h.emit(assistant("I'll inspect the files.", "toolUse"));
  h.emit({ type: "message_end", message: { role: "user", content: "User text", timestamp: 0 } });
  h.emit(assistant("**Done.** All tests pass."));
  h.emit({ type: "agent_end", messages: [] });
  h.beforeSettle();
  assert.deepEqual(h.writes, [], "neither agent_end nor the actionable boundary should notify");
  h.setSessionName("Fix notifications");
  h.settle();
  h.settle();
  assert.deepEqual(h.writes, [
    "\x1b]777;notify;Pi · app · Fix notifications;Done. All tests pass.\x07",
  ]);
});

it("waits through retries and boundary continuations without leaking an earlier preview", () => {
  const h = harness();
  h.start();
  h.emit(assistant("", "error", "Temporary failure"));
  h.start();
  h.emit(assistant("Intermediate answer"));
  h.beforeSettle();
  // Another extension requests a continuation; the low-level run starts again.
  h.start();
  h.emit(assistant("Final answer"));
  assert.deepEqual(h.writes, []);
  h.beforeSettle();
  h.settle();
  assert.deepEqual(h.writes, ["\x1b]777;notify;Pi · app;Final answer\x07"]);
});

it("skips aborts, including cancellation that bypasses before-settle", () => {
  for (const withBoundary of [false, true]) {
    const h = harness();
    h.start();
    h.emit(assistant("Partial response", "aborted"));
    if (withBoundary) h.beforeSettle("aborted");
    h.settle();
    assert.deepEqual(h.writes, []);
  }
  const h = harness();
  h.start();
  h.emit(assistant("Looks finished"));
  h.beforeSettle();
  h.controller.abort();
  h.settle();
  assert.deepEqual(h.writes, [], "an aborted operation signal must suppress notifications");
});

it("uses generic text for empty answers and error previews for terminal errors", () => {
  const h = harness();
  h.start();
  h.emit(assistant("```ts\ncode\n```"));
  h.beforeSettle();
  h.settle();
  h.start();
  h.emit(assistant("", "error", "Request failed: quota exhausted"));
  h.beforeSettle("error");
  h.settle();
  h.start();
  h.emit(assistant("", "error"));
  h.beforeSettle("error");
  h.settle();
  assert.deepEqual(h.writes, [
    "\x1b]777;notify;Pi · app;Finished. Ready for input.\x07",
    "\x1b]777;notify;Pi · app;Request failed: quota exhausted\x07",
    "\x1b]777;notify;Pi · app;Pi stopped with an error.\x07",
  ]);
});

it("does not notify without an active run or after a session reset/shutdown", () => {
  const h = harness();
  h.beforeSettle();
  h.settle();
  assert.deepEqual(h.writes, []);
  for (const reset of [h.sessionStart, h.shutdown]) {
    h.start();
    h.emit(assistant("Old session"));
    h.beforeSettle();
    reset();
    h.settle();
    assert.deepEqual(h.writes, []);
  }
});

it("never emits escape sequences in unsupported modes, terminals, or tmux", async () => {
  for (const options of [
    { mode: "print" as const },
    { mode: "json" as const },
    { mode: "rpc" as const },
    { hasUI: false },
    { env: { TERM: "xterm-256color" } },
    { env: { TERM: "xterm-ghostty", TMUX: "/tmp/tmux" } },
  ]) {
    const h = harness(options);
    h.start();
    h.emit(assistant("Done"));
    h.beforeSettle();
    h.settle();
    await h.test();
    assert.deepEqual(h.writes, []);
    h.shutdown();
  }
});

it("delays /notify test, replaces pending tests, and uses the native notification path", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  await h.test();
  t.mock.timers.tick(4_000);
  assert.deepEqual(h.writes, []);
  await h.test();
  t.mock.timers.tick(4_999);
  assert.deepEqual(h.writes, []);
  t.mock.timers.tick(1);
  assert.deepEqual(h.writes, [
    "\x1b]777;notify;Pi · app;Notifications are working. Click to return to this Pi session.\x07",
  ]);
  assert.equal(h.notices.length, 2);
  await h.test("invalid");
  assert.equal(h.notices.at(-1), "Usage: /notify test");
});

it("cancels delayed tests on session replacement and idempotent shutdown", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  await h.test();
  h.sessionStart();
  t.mock.timers.tick(5_000);
  await h.test();
  h.shutdown();
  h.shutdown();
  t.mock.timers.tick(5_000);
  assert.deepEqual(h.writes, []);
});
