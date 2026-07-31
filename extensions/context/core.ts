export type ProgressColor = "success" | "warning" | "error";

export interface ContextUsageLike {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface ContextProgress {
  percent: number | null;
  filled: number;
  empty: number;
  color: ProgressColor;
}

export const DEFAULT_BAR_WIDTH = 10;

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function colorForPercent(percent: number): ProgressColor {
  if (percent >= 90) return "error";
  if (percent >= 70) return "warning";
  return "success";
}

export function getContextProgress(
  usage: ContextUsageLike | undefined,
  width = DEFAULT_BAR_WIDTH,
): ContextProgress {
  const safeWidth = Math.max(1, Math.floor(width));

  if (usage?.percent === null || usage?.percent === undefined) {
    return {
      percent: null,
      filled: 0,
      empty: safeWidth,
      color: "success",
    };
  }

  const percent = clampPercent(usage.percent);
  const filled = Math.round((percent / 100) * safeWidth);

  return {
    percent,
    filled,
    empty: safeWidth - filled,
    color: colorForPercent(percent),
  };
}

export function formatPercent(percent: number | null): string {
  return percent === null ? "--%" : `${Math.round(percent)}%`;
}
