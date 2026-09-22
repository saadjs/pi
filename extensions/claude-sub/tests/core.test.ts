import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, test } from "node:test";
import { addOAuthBillingBlock, afterPayloadHook } from "../core.ts";

const originalVersion = process.env.PI_CLAUDE_SUB_VERSION;
delete process.env.PI_CLAUDE_SUB_VERSION;
after(() => {
  if (originalVersion === undefined) delete process.env.PI_CLAUDE_SUB_VERSION;
  else process.env.PI_CLAUDE_SUB_VERSION = originalVersion;
});

function payload() {
  return {
    model: "claude-opus-5-5",
    stream: true,
    messages: [{ role: "user", content: [{ type: "text", text: "Please do the task." }] }],
    system: [
      {
        type: "text",
        text: "You are Claude Code, Anthropic's official CLI for Claude.",
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: "You are an expert coding assistant operating inside pi.\n<docs>Keep docs</docs>",
      },
    ],
    tools: [{ name: "read", description: "Read a file" }],
  };
}

test("API keys and unknown payloads pass through by identity", () => {
  const input = payload();
  assert.equal(addOAuthBillingBlock(input, "sk-ant-api03-key"), input);
  assert.equal(addOAuthBillingBlock(input, undefined), input);
  const other = { messages: [], stream: false };
  assert.equal(addOAuthBillingBlock(other, "sk-ant-oat01-token"), other);
});

test("OAuth prepends one uncached billing block without rewriting messages, tools, or Pi's prompt", () => {
  const input = payload();
  const shaped = addOAuthBillingBlock(input, "sk-ant-oat01-token") as typeof input;
  assert.equal(input.system.length, 2);
  assert.equal(shaped.system.length, 3);
  assert.match(
    shaped.system[0].text,
    /^x-anthropic-billing-header: cc_version=2\.1\.280\.[a-f0-9]{3}; cc_entrypoint=sdk-cli; cch=[a-f0-9]{5};$/,
  );
  assert.equal("cache_control" in shaped.system[0], false);
  assert.equal(shaped.system[1], input.system[0]);
  assert.equal(shaped.system[2], input.system[1]);
  assert.equal(shaped.messages, input.messages);
  assert.equal(shaped.tools, input.tools);
  assert.equal(addOAuthBillingBlock(shaped, "sk-ant-oat01-token"), shaped);
});

test("billing hash and version override", () => {
  process.env.PI_CLAUDE_SUB_VERSION = "2.1.300";
  const text = "Please do the task.";
  const hash = (value: string, len: number) =>
    createHash("sha256").update(value).digest("hex").slice(0, len);
  const sampled = [4, 7, 20].map((pos) => text[pos] || "0").join("");
  const shaped = addOAuthBillingBlock(payload(), "sk-ant-oat01-token") as ReturnType<
    typeof payload
  >;
  assert.equal(
    shaped.system[0].text,
    `x-anthropic-billing-header: cc_version=2.1.300.${hash(`59cf53e54c78${sampled}2.1.300`, 3)}; cc_entrypoint=sdk-cli; cch=${hash(text, 5)};`,
  );
  process.env.PI_CLAUDE_SUB_VERSION = "invalid";
  assert.throws(
    () => addOAuthBillingBlock(payload(), "sk-ant-oat01-token"),
    /must be an X\.Y\.Z version/,
  );
  delete process.env.PI_CLAUDE_SUB_VERSION;
});

test("no first user text is unchanged, and string system prompts are preserved", () => {
  const noText = { ...payload(), messages: [{ role: "user", content: [{ type: "image" }] }] };
  assert.equal(addOAuthBillingBlock(noText, "sk-ant-oat01-token"), noText);
  const input = { ...payload(), system: "Custom system prompt" };
  const shaped = addOAuthBillingBlock(input, "sk-ant-oat01-token") as {
    system: { text: string }[];
  };
  assert.equal(shaped.system[1].text, input.system);
});

test("other payload hooks run first; no-hook requests (e.g. compaction) are shaped", async () => {
  const model = { id: "claude-opus-5-5" };
  let passedModel: unknown;
  const previous = (value: unknown, received: typeof model) => {
    passedModel = received;
    return { ...(value as object), system: [{ type: "text", text: "From earlier hook" }] };
  };
  const result = (await afterPayloadHook(
    payload(),
    model,
    previous,
    "sk-ant-oat01-token",
  )) as ReturnType<typeof payload>;
  assert.equal(passedModel, model);
  assert.equal(result.system[1].text, "From earlier hook");
  const compact = (await afterPayloadHook(
    payload(),
    model,
    undefined,
    "sk-ant-oat01-token",
  )) as ReturnType<typeof payload>;
  assert.match(compact.system[0].text, /^x-anthropic-billing-header:/);
});
