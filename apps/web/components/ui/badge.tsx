import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "success" | "danger" | "warning" | "info" | "neutral" | "gold";

// A pale tint alone washes out completely on a tablet screen in direct sunlight — pairing it with
// a solid-color border keeps the badge's outline (and therefore its status) visible even when the
// tint itself is glare-crushed toward white.
const TONE_CLASSES: Record<Tone, string> = {
  success: "border border-success/60 bg-success/10 text-success",
  danger: "border border-danger/60 bg-danger/10 text-danger",
  warning: "border border-warning/60 bg-warning/10 text-warning",
  info: "border border-info/60 bg-info/10 text-info",
  neutral: "border border-muted/50 bg-muted/15 text-muted",
  gold: "border border-[color:var(--color-burgundy-dark)]/50 bg-gold/20 text-[color:var(--color-burgundy-dark)]",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        TONE_CLASSES[tone]
      )}
    >
      {children}
    </span>
  );
}
