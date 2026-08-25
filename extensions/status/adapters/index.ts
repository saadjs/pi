import { codexAdapter } from "./codex";
import { openCodeAdapter } from "./opencode";
import type { UsageProviderAdapter } from "./types";

/** Add or remove provider adapters only in this registry. */
export const usageProviderAdapters: readonly UsageProviderAdapter[] = [
  codexAdapter,
  openCodeAdapter,
];

const adaptersByProvider = new Map<string, UsageProviderAdapter>();
for (const adapter of usageProviderAdapters) {
  for (const providerId of adapter.providerIds) {
    if (adaptersByProvider.has(providerId)) {
      throw new Error(`Duplicate usage adapter for provider: ${providerId}`);
    }
    adaptersByProvider.set(providerId, adapter);
  }
}

export function findUsageProviderAdapter(
  providerId: string | undefined,
): UsageProviderAdapter | undefined {
  return providerId ? adaptersByProvider.get(providerId) : undefined;
}

export type { UsageProviderAdapter } from "./types";
