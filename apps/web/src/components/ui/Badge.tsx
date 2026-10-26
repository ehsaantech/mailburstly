import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "outline";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-muted text-fg-muted border-transparent",
  accent: "bg-accent-soft text-accent border-accent-border",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
  outline: "bg-transparent text-fg-muted border-border-strong",
};

export function Badge({
  children,
  tone = "neutral",
  className,
  dot,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
        "text-[11px] font-medium leading-tight whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {dot ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  );
}

/** Status pill with a live-looking dot. */
export function StatusDot({
  tone,
  className,
}: {
  tone: Tone;
  className?: string;
}) {
  const colors: Record<Tone, string> = {
    neutral: "bg-fg-subtle",
    accent: "bg-accent",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
    outline: "bg-fg-subtle",
  };
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full",
        colors[tone],
        className,
      )}
    />
  );
}
