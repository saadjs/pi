import { createHash } from "node:crypto";

const DEFAULT_VERSION = "2.1.280";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstUserText(messages: unknown[]): string | undefined {
  const user = messages.find((message) => isRecord(message) && message.role === "user");
  if (!isRecord(user)) return undefined;
  if (typeof user.content === "string") return user.content || undefined;
  if (!Array.isArray(user.content)) return undefined;
  const block = user.content.find(
    (item: unknown) => isRecord(item) && item.type === "text" && typeof item.text === "string",
  );
  return isRecord(block) && typeof block.text === "string" ? block.text || undefined : undefined;
}

function billingBlock(text: string): { type: "text"; text: string } {
  const version = process.env.PI_CLAUDE_SUB_VERSION?.trim() || DEFAULT_VERSION;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("PI_CLAUDE_SUB_VERSION must be an X.Y.Z version");
  }
  const hash = (value: string, length: number) =>
    createHash("sha256").update(value).digest("hex").slice(0, length);
  const sample = [4, 7, 20].map((position) => text[position] || "0").join("");
  return {
    type: "text",
    text: `x-anthropic-billing-header: cc_version=${version}.${hash(`59cf53e54c78${sample}${version}`, 3)}; cc_entrypoint=sdk-cli; cch=${hash(text, 5)};`,
  };
}

/** Leave API-key requests and all existing messages, prompts, tools, and cache markers untouched. */
export function addOAuthBillingBlock(payload: unknown, apiKey: string | undefined): unknown {
  if (
    !apiKey?.startsWith("sk-ant-oat") ||
    !isRecord(payload) ||
    payload.stream !== true ||
    !Array.isArray(payload.messages)
  )
    return payload;

  const text = firstUserText(payload.messages);
  if (!text) return payload;
  const system = Array.isArray(payload.system)
    ? payload.system
    : typeof payload.system === "string"
      ? [{ type: "text", text: payload.system }]
      : [];
  if (
    system.some(
      (block: unknown) =>
        isRecord(block) &&
        typeof block.text === "string" &&
        block.text.startsWith("x-anthropic-billing-header:"),
    )
  )
    return payload;

  return { ...payload, system: [billingBlock(text), ...system] };
}

/** Run other extensions' payload hooks first; compaction calls this without an earlier hook. */
export async function afterPayloadHook<TModel>(
  payload: unknown,
  model: TModel,
  previous: ((payload: unknown, model: TModel) => unknown | Promise<unknown>) | undefined,
  apiKey: string | undefined,
): Promise<unknown> {
  return addOAuthBillingBlock((await previous?.(payload, model)) ?? payload, apiKey);
}
