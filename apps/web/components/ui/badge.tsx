import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "success" | "danger" | "warning" | "info" | "neutral" | "gold";

// A pale tint alone washes out on a tablet in direct sunlight — a solid-colour border keeps the
// outline visible. All tone text colours pass WCAG AA (>=4.5:1) on white and on their own tint.
const TONE_CLASSES: Record<Tone, string> = {
  success: "border border-success/60 bg-success/10 text-success",
  danger: "border border-danger/60 bg-danger/10 text-danger",
  warning: "border border-warning/60 bg-warning/10 text-warning",
  info: "border border-info/60 bg-info/10 text-info",
  neutral: "border border-muted/50 bg-muted/15 text-muted",
  gold: "border border-[color:var(--color-burgundy-dark)]/50 bg-gold/20 text-[color:var(--color-burgundy-dark)]",
};

/** Default glyph per tone so colour is never the only status signal. */
export const TONE_ICON: Record<Tone, string> = {
  success: "✓",
  danger: "✕",
  warning: "!",
  info: "i",
  neutral: "•",
  gold: "★",
};

export function Badge({
  tone = "neutral",
  children,
  icon,
  showIcon = true,
  srPrefix,
}: {
  tone?: Tone;
  children: ReactNode;
  /** Custom leading icon/text. Takes precedence over the default tone glyph. */
  icon?: ReactNode;
  /** Default per-tone glyph, on unless turned off — colour must not be the only status cue. */
  showIcon?: boolean;
  /** Visually hidden text read before the label, e.g. "Status:". */
  srPrefix?: string;
}) {
  const lead = icon ?? (showIcon ? TONE_ICON[tone] : null);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        TONE_CLASSES[tone]
      )}
    >
      {lead != null && (
        <span aria-hidden="true" className="leading-none">
          {lead}
        </span>
      )}
      {srPrefix && <span className="sr-only">{srPrefix} </span>}
      {children}
    </span>
  );
}
