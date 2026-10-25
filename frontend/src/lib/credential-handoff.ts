/** Hands a device's one-time credential from where it was made (Add device,
 * or Rotate on the connect page) to the connect flow without rotating it
 * again. DESIGN.md §8: it survives a reload, so it is kept in this tab's
 * sessionStorage (never localStorage, never sent anywhere) for the length of
 * the connect flow, and forgotten when the flow is left or the device is
 * live. Closing the tab drops it too. Where storage is blocked, memory still
 * carries it within the page.
 *
 * Each credential is kept with the device's `credential_rotated_at` from when
 * it was made: one rotated elsewhere since (another admin, the API) no longer
 * matches the device, so it is dropped rather than shown as current. */
import type { SketchCredential } from "@/lib/firmware-sketch";

interface Held {
  credential: SketchCredential;
  rotatedAt: string | null;
}

const pending = new Map<string, Held>();
const storageKey = (deviceId: string) => `iot:credential:${deviceId}`;

export function handOffCredential(
  device: { id: string; credential_rotated_at?: string | null },
  credential: SketchCredential,
): void {
  const held: Held = { credential, rotatedAt: device.credential_rotated_at ?? null };
  pending.set(device.id, held);
  try {
    window.sessionStorage.setItem(storageKey(device.id), JSON.stringify(held));
  } catch {
    // Private mode or blocked storage: memory only.
  }
}

function read(deviceId: string): Held | null {
  const inMemory = pending.get(deviceId);
  if (inMemory) return inMemory;
  try {
    const raw = window.sessionStorage.getItem(storageKey(deviceId));
    if (!raw) return null;
    const held = JSON.parse(raw) as Partial<Held>;
    const c = held.credential;
    if (!c || typeof c.username !== "string" || typeof c.password !== "string") return null;
    return { credential: c, rotatedAt: typeof held.rotatedAt === "string" ? held.rotatedAt : null };
  } catch {
    return null;
  }
}

/** The kept credential, if the device's credential is still the one it was
 * kept with; otherwise null (and it's forgotten). Pass `undefined` while the
 * device hasn't loaded yet to read without checking. */
export function peekCredential(deviceId: string, rotatedAt?: string | null): SketchCredential | null {
  const held = read(deviceId);
  if (!held) return null;
  if (rotatedAt !== undefined && held.rotatedAt !== rotatedAt) {
    forgetCredential(deviceId);
    return null;
  }
  return held.credential;
}

export function forgetCredential(deviceId: string): void {
  pending.delete(deviceId);
  try {
    window.sessionStorage.removeItem(storageKey(deviceId));
  } catch {
    // Nothing stored.
  }
}
