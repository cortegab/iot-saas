import qrcode from "qrcode-generator";

const QUIET = 2; // modules of white border around the code

/** A QR code's dark modules as one SVG path, in module units (with a quiet zone). */
export function qrPath(payload: string): { size: number; d: string } {
  const qr = qrcode(0, "M");
  qr.addData(payload);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + QUIET},${r + QUIET}h1v1h-1z`;
  return { size: n + QUIET * 2, d };
}

/** Text escaped for SVG/HTML markup. */
export const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A printable label: the QR with a name under it and a small caption. */
export function labelSvg(name: string, caption: string, qr: { size: number; d: string }): string {
  const W = 320;
  const H = 372;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#fff"/>
<svg x="20" y="16" width="280" height="280" viewBox="0 0 ${qr.size} ${qr.size}" shape-rendering="crispEdges"><path d="${qr.d}" fill="#000"/></svg>
<text x="${W / 2}" y="322" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="18" font-weight="600" fill="#111">${xml(name)}</text>
<text x="${W / 2}" y="348" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#555">${xml(caption)}</text>
</svg>`;
}

/** Saves an SVG label as a file. */
export function downloadSvg(svg: string, fileName: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Opens an SVG label in a print window; false when the window was blocked. */
export function printSvg(svg: string, title: string): boolean {
  const w = window.open("", "_blank", "width=420,height=520");
  if (!w) return false;
  w.document.write(`<!doctype html><title>${xml(title)}</title><body style="margin:24px">${svg}</body>`);
  w.document.close();
  w.focus();
  w.print();
  return true;
}

/** A file-safe version of a name. */
export const fileBase = (name: string) => name.replace(/[^a-zA-Z0-9_-]+/g, "_");
