import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-1.5 transition-colors duration-150 disabled:opacity-60 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-3 py-2 text-sm",
};

/** `primary`/`secondary` are the padded button shape (sized via `size`).
 * `ghost`/`destructive` are the plain inline text-action shape (e.g. "+ Add
 * metric", "Remove") and ignore `size` — that shape never carried padding in
 * any of the recipes this was consolidated from. */
const PADDED_VARIANTS = new Set<ButtonVariant>(["primary", "secondary"]);

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "rounded-md border border-accent bg-accent font-medium text-on-accent hover:border-accent-strong hover:bg-accent-strong",
  secondary:
    "rounded-md border border-border font-medium text-ink-muted hover:bg-surface-raised hover:text-ink",
  destructive: "text-sm text-status-error hover:underline",
  ghost: "text-sm text-accent hover:underline",
};

export interface ButtonClassNameOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/** Shared recipe so non-`<button>` elements styled as a button (a Next `Link`
 * used as a primary CTA, e.g. "Add device") stay in sync with `<Button>`
 * instead of hand-copying its className and drifting from it over time. */
export function buttonClassName({
  variant = "primary",
  size = "sm",
  className,
}: ButtonClassNameOptions = {}): string {
  return cn(BASE, VARIANT_CLASSES[variant], PADDED_VARIANTS.has(variant) && SIZE_CLASSES[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = "primary", size = "sm", className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClassName({ variant, size, className })} {...props} />;
}
