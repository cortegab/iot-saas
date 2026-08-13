import { clsx, type ClassValue } from "clsx";

/** Joins conditional className fragments — thin wrapper so primitives don't
 * hand-roll ternary strings that drift from each other. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
