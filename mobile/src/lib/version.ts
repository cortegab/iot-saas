/** "1.2.3" versions, as the app and the API's /meta/client use them. */
function parts(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative when a < b, 0 when equal, positive when a > b; an unreadable
 * version compares as equal, so it never blocks anyone. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** Android's versionCode for a version: 1.2.3 → 10203. Increases with every
 * release, as Play requires (app.config.ts computes the same). */
export function versionCode(v: string): number {
  const p = parts(v);
  if (!p) throw new Error(`Not a version: ${v}`);
  return p[0] * 10000 + p[1] * 100 + p[2];
}
