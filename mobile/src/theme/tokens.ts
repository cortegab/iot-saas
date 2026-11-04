/** DESIGN.md tokens for the app: the same palette, type scale and radii as
 * the web (frontend/src/app/globals.css). tokens.test.ts fails if a colour
 * here drifts from globals.css, so change the web's first (DESIGN.md wins). */

export type ColorToken =
  | "canvas"
  | "surface"
  | "surfaceRaised"
  | "border"
  | "borderSoft"
  | "ink"
  | "inkMuted"
  | "accent"
  | "accentStrong"
  | "accentMuted"
  | "onAccent"
  | "chart"
  | "statusOnline"
  | "statusOffline"
  | "statusPending"
  | "statusUnknown"
  | "statusError"
  | "statusErrorSurface"
  | "statusPendingSurface"
  | "input";

export type Palette = Record<ColorToken, string>;

export const light: Palette = {
  canvas: "#f7f7f8",
  surface: "#ffffff",
  surfaceRaised: "#f2f2f5",
  border: "#e3e3e8",
  borderSoft: "#eeeef2",
  ink: "#15161a",
  inkMuted: "#62646f",
  accent: "#4f46e5",
  accentStrong: "#4338ca",
  accentMuted: "#eef0ff",
  onAccent: "#ffffff",
  chart: "#0e7490",
  statusOnline: "#15803d",
  statusOffline: "#dc2626",
  statusPending: "#b45309",
  statusUnknown: "#6b7280",
  statusError: "#dc2626",
  statusErrorSurface: "#fef2f2",
  statusPendingSurface: "#fffbeb",
  input: "#ffffff",
};

export const dark: Palette = {
  canvas: "#0f1014",
  surface: "#16171c",
  surfaceRaised: "#1e2027",
  border: "#2a2c34",
  borderSoft: "#222329",
  ink: "#ececf1",
  inkMuted: "#9a9ca8",
  accent: "#818cf8",
  accentStrong: "#a5b4fc",
  accentMuted: "#1f2040",
  onAccent: "#0f1014",
  chart: "#22d3ee",
  statusOnline: "#4ade80",
  statusOffline: "#f87171",
  statusPending: "#fbbf24",
  statusUnknown: "#9ca3af",
  statusError: "#f87171",
  statusErrorSurface: "#2a1517",
  statusPendingSurface: "#2a2211",
  input: "#121318",
};

/** DESIGN.md §3: five steps, through tokens only. */
export const text = {
  micro: { fontSize: 12, lineHeight: 17 },
  meta: { fontSize: 13, lineHeight: 19 },
  sm: { fontSize: 14, lineHeight: 20 },
  section: { fontSize: 16, lineHeight: 22 },
  title: { fontSize: 28, lineHeight: 34 },
} as const;

export const radius = { sm: 6, md: 8, lg: 10, xl: 12, "2xl": 16 } as const;

/** Geist, the web's face (DESIGN.md §3), loaded in the root layout. */
export const font = {
  regular: "Geist_400Regular",
  medium: "Geist_500Medium",
  semibold: "Geist_600SemiBold",
} as const;

/** DESIGN.md §12: the minimum touch target on touch screens. */
export const touchTarget = 44;
