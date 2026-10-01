/** Hands a freshly created device's one-time credential from the create page
 * to its connect page without rotating it again. In-memory only: it never
 * touches storage, and a reload loses it (the connect page then offers to
 * rotate, which is the only other way to see a credential). */
import type { SketchCredential } from "@/lib/firmware-sketch";

const pending = new Map<string, SketchCredential>();

export function handOffCredential(deviceId: string, credential: SketchCredential): void {
  pending.set(deviceId, credential);
}

export function peekCredential(deviceId: string): SketchCredential | null {
  return pending.get(deviceId) ?? null;
}

export function forgetCredential(deviceId: string): void {
  pending.delete(deviceId);
}
