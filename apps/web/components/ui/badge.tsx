import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "success" | "danger" | "warning" | "info" | "neutral" | "gold";

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success/10 text-success",
  danger: "bg-danger/10 text-danger",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
  neutral: "bg-muted/15 text-muted",
  gold: "bg-gold/20 text-[color:var(--color-burgundy-dark)]",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone]
      )}
    >
      {children}
    </span>
  );
}
