import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { UsageLimit } from "../core";

/** Everything provider-specific needed by the generic status command. */
export interface UsageProviderAdapter {
  readonly providerIds: readonly string[];
  readonly displayName: string;
  fetchUsage(ctx: ExtensionCommandContext): Promise<UsageLimit[]>;
}
