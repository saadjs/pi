import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { UsageLimit, UsagePage } from "../core";

/** Everything provider-specific needed by the generic status command. */
export interface UsageProviderAdapter {
  readonly providerIds: readonly string[];
  readonly displayName: string;
  /** Rejects credentials that have no usage to report; omit when every credential has usage. */
  supports?(ctx: ExtensionCommandContext): boolean;
  /** Limits to draw as bars, or a page to link when the provider has no usage API Pi can call. */
  fetchUsage(ctx: ExtensionCommandContext): Promise<UsageLimit[] | UsagePage>;
}
