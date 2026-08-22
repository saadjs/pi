import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const effortLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type EffortLevel = (typeof effortLevels)[number];
type EffortModel = {
  reasoning: boolean;
  thinkingLevelMap?: Partial<Record<EffortLevel, string | null>>;
};

function getSupportedEfforts(model: EffortModel | undefined): EffortLevel[] {
  if (!model?.reasoning) return ["off"];

  return effortLevels.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

export default function (pi: ExtensionAPI) {
  let supportedEfforts: EffortLevel[] = ["off"];

  pi.on("session_start", (_event, ctx) => {
    supportedEfforts = getSupportedEfforts(ctx.model);
  });

  pi.on("model_select", (event) => {
    supportedEfforts = getSupportedEfforts(event.model);
  });

  pi.registerCommand("effort", {
    description: "Set the current model's reasoning effort",
    getArgumentCompletions: (prefix) => {
      const query = prefix.trim().toLowerCase();
      const matches = supportedEfforts.filter((level) => level.startsWith(query));
      return matches.length > 0
        ? matches.map((level) => ({
            value: level,
            label: level,
            description: level === pi.getThinkingLevel() ? "current" : undefined,
          }))
        : null;
    },
    handler: async (args, ctx) => {
      supportedEfforts = getSupportedEfforts(ctx.model);
      const level = args.trim().toLowerCase();
      const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "the current model";

      if (!supportedEfforts.includes(level as EffortLevel)) {
        const message = level
          ? `Unsupported effort "${level}" for ${model}. Supported: ${supportedEfforts.join(", ")}`
          : `Usage: /effort <${supportedEfforts.join("|")}>`;
        ctx.ui.notify(message, level ? "error" : "warning");
        return;
      }

      pi.setThinkingLevel(level as EffortLevel);
      ctx.ui.notify(`Effort: ${pi.getThinkingLevel()}`, "info");
    },
  });
}
