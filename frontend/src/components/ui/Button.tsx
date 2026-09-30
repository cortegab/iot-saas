import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** DESIGN.md §5 Button. `primary` · `secondary` · `ghost` · `danger` are the
 * padded button shapes (36px, or 30px at `size="sm"`). One primary per view;
 * labels are verbs ("Save rule", "Add device").
 *
 * `link` / `link-danger` are the inline text-action shape ("+ Add metric",
 * "Remove") — no padding, `size` is ignored. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link" | "link-danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50";

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-[30px] rounded-md px-2.5 text-xs font-medium",
  md: "h-control rounded-md px-3.5 text-sm font-medium",
};

const INLINE_VARIANTS = new Set<ButtonVariant>(["link", "link-danger"]);

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "border border-transparent bg-accent text-on-accent shadow-[0_1px_2px_rgba(40,30,120,.25),inset_0_1px_0_rgba(255,255,255,.15)] hover:bg-accent-strong",
  secondary: "border border-border bg-surface-raised text-ink hover:border-ink-muted",
  ghost: "border border-transparent bg-transparent text-ink-muted hover:bg-surface-raised hover:text-ink",
  danger: "border border-transparent bg-status-error text-on-accent hover:brightness-110",
  link: "text-sm text-accent hover:underline",
  "link-danger": "text-sm text-status-error hover:underline",
};

export interface ButtonClassNameOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/** Shared recipe so non-`<button>` elements styled as a button (a Next `Link`
 * used as a primary CTA, e.g. "Add device") stay in sync with `<Button>`. */
export function buttonClassName({
  variant = "primary",
  size = "md",
  className,
}: ButtonClassNameOptions = {}): string {
  return cn(BASE, VARIANT_CLASSES[variant], !INLINE_VARIANTS.has(variant) && SIZE_CLASSES[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = "primary", size = "md", className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClassName({ variant, size, className })} {...props} />;
}

/** Square 30px icon-only button (row menus, panel tools). Always pass an
 * `aria-label`. */
export function IconButton({ className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        "inline-grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
