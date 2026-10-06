import { cn } from "@/lib/cn";

/** Buttons on the night surfaces (demo G `.s-btn`): the gradient call to
 * action, or the translucent ghost beside it. */
export function nightButtonClassName({ kind = "cta", size = "md" }: { kind?: "cta" | "ghost"; size?: "md" | "lg" } = {}) {
  return cn(
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] font-semibold transition-[filter,background-color]",
    size === "lg" ? "h-[46px] px-5 text-[15px]" : "h-[38px] px-4 text-sm",
    kind === "cta" ? "night-cta" : "night-ghost",
  );
}
