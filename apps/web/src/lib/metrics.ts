import { cn } from "./cn";

/**
 * Colour a reply-rate figure against the workspace benchmark.
 *
 * Green means "at or above target", muted means "below". Deliberately not red:
 * a low reply rate is normal, not an error — red would cry wolf on every
 * campaign and destroy the signal.
 */
export function replyRateClass(
  rate: number,
  threshold: number,
  className?: string,
): string {
  return cn(
    "tabular font-medium",
    rate >= threshold ? "text-success" : "text-fg-muted",
    className,
  );
}

/** Short label describing where a campaign's pipeline sits. */
export function pipelineRiskLabel(status: string): string | null {
  if (status === "paused") return "at risk";
  if (status === "draft") return null;
  return null;
}
