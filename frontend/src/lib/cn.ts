import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins conditional className fragments and resolves conflicting Tailwind
 * utilities so a caller's `className` prop reliably wins over a primitive's
 * defaults (last one set takes effect), instead of both landing in the string
 * and the winner coming down to CSS source order. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
