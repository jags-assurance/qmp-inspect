import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * The one button style for the whole app. Use <Button> for real buttons and buttonVariants() for a link
 * that must look like one (<Link className={buttonVariants({ variant: "outline" })}>), so every action
 * shares the same size, shape, colours and states.
 *
 * Variants (importance, highest first): primary = THE action of a form or card (one per group);
 * outline = other actions; ghost = low-emphasis / toolbar; danger = destructive and final (delete,
 * withdraw); danger-outline = destructive but not final; link / link-muted / link-danger = inline text
 * actions inside a sentence, row or table cell.
 *
 * Sizes follow the usual 8-point scale: sm 32 px (dense rows, tables), md 40 px (default), lg 48 px
 * (a single prominent call to action). Text is never smaller than 14 px. On touch screens every size
 * grows to at least 44 px (WCAG 2.2 / Apple HIG / Material target size), except inline links, which
 * keep a comfortable 36 px so they still flow with the text around them.
 *
 * Order inside a group (see ButtonGroup): primary first, then outline, then ghost/cancel, destructive last.
 */
export type ButtonVariant = "primary" | "outline" | "ghost" | "danger" | "danger-outline" | "link" | "link-muted" | "link-danger";
/** "icon" = square icon-only button (40 px, 44 px on touch); always pass aria-label. */
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-burgundy text-white shadow-xs hover:bg-burgundy-dark",
  outline: "border border-control-border text-ink bg-surface shadow-xs hover:bg-surface-subtle",
  ghost: "text-ink hover:bg-surface-subtle",
  danger: "bg-danger text-white hover:bg-danger/90",
  "danger-outline": "border border-danger/40 text-danger bg-surface hover:bg-danger/5",
  link: "text-burgundy hover:underline underline-offset-2",
  "link-muted": "text-muted hover:text-ink hover:underline underline-offset-2",
  "link-danger": "text-danger hover:underline underline-offset-2",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "text-sm px-3 min-h-8 [@media(pointer:coarse)]:min-h-11",
  md: "text-sm px-4 min-h-10 [@media(pointer:coarse)]:min-h-11",
  lg: "text-base px-5 min-h-12",
  icon: "h-10 w-10 p-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
};

// Inline text actions have no box, so no horizontal padding; they only need a little vertical room.
const LINK_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "text-sm py-1 min-h-8 [@media(pointer:coarse)]:min-h-9",
  md: "text-sm py-1.5 min-h-9 [@media(pointer:coarse)]:min-h-9",
  lg: "text-base py-2 min-h-10 [@media(pointer:coarse)]:min-h-10",
  icon: "h-9 w-9 p-0",
};

export function buttonVariants({ variant = "primary", size = "md", className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  const isLink = variant.startsWith("link");
  return cn(BASE, VARIANT_CLASSES[variant], isLink ? LINK_SIZE_CLASSES[size] : SIZE_CLASSES[size], className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button ref={ref} className={buttonVariants({ variant, size, className })} {...props} />
  )
);
Button.displayName = "Button";

/**
 * A row of related actions with one consistent gap and wrapping on narrow screens. Put the primary
 * action first, then secondary actions, then Cancel, with a destructive action last.
 */
export function ButtonGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="group" className={cn("flex flex-wrap items-center gap-2", className)} {...props} />;
}
