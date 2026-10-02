import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { HttpError, isObject, type FetchUsage, type UsageLimit } from "../core.ts";
import { fetchCodexUsage } from "./codex.ts";
import type { UsageProviderAdapter } from "./types";

/** The page Pi itself links when a ChatGPT sign-in reaches its usage limit. */
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

export interface CodexCliLogin {
  accessToken: string;
  accountId?: string;
}

export function parseCodexCliLogin(payload: unknown): CodexCliLogin | undefined {
  if (!isObject(payload) || !isObject(payload.tokens)) return undefined;
  const accessToken = payload.tokens.access_token;
  if (typeof accessToken !== "string" || !accessToken.trim()) return undefined;

  const accountId = payload.tokens.account_id;
  return {
    accessToken: accessToken.trim(),
    accountId: typeof accountId === "string" && accountId.trim() ? accountId.trim() : undefined,
  };
}

/**
 * Only reads the Codex CLI's login: refreshing it here would rotate its refresh token out from
 * under the Codex CLI and app.
 */
async function readCodexCliLogin(): Promise<CodexCliLogin | undefined> {
  const home = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  const authPath = join(home, "auth.json");

  let contents: string;
  try {
    contents = await readFile(authPath, "utf8");
  } catch (error) {
    // Only a missing file means "not logged in"; anything else is a real problem worth reporting.
    const code = isObject(error) ? error.code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw new Error(`cannot read ${authPath}: ${(error as Error).message}`);
  }

  try {
    return parseCodexCliLogin(JSON.parse(contents));
  } catch {
    throw new Error(`invalid JSON in ${authPath}`);
  }
}

/** Sign in with ChatGPT shares the plan's one usage limit with Codex, so read Codex's. */
export async function fetchChatGPTUsage(
  login: CodexCliLogin,
  fetchUsage: FetchUsage = fetch,
): Promise<UsageLimit[]> {
  try {
    return await fetchCodexUsage(login.accessToken, fetchUsage, login.accountId);
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
      throw new Error("Codex CLI login expired; run codex to refresh it");
    }
    throw error;
  }
}

/**
 * Pi's Sign in with ChatGPT token cannot read usage, so borrow the Codex CLI's login, which must
 * be for the same ChatGPT account. Without one, link ChatGPT's usage page instead.
 */
export const chatGPTAdapter: UsageProviderAdapter = {
  providerIds: ["openai"],
  displayName: "OpenAI (ChatGPT)",
  // OAuth on the openai provider is Sign in with ChatGPT; API keys have no subscription usage.
  supports: (ctx: ExtensionCommandContext) =>
    ctx.model !== undefined && ctx.modelRegistry.isUsingOAuth(ctx.model),
  async fetchUsage() {
    const login = await readCodexCliLogin();
    return login ? fetchChatGPTUsage(login) : { url: CHATGPT_USAGE_URL };
  },
};
