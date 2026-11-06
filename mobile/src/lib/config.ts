/** Where the API is: EXPO_PUBLIC_API_URL, inlined at build time (eas.json per
 * build profile, mobile/.env locally). No trailing slash. */
export function apiUrl(raw: string | undefined = process.env.EXPO_PUBLIC_API_URL): string {
  const url = (raw ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+/.test(url)) {
    throw new Error("EXPO_PUBLIC_API_URL is missing or not an http(s) URL. Set it in mobile/.env (see .env.example).");
  }
  return url;
}

/** The web app, for what stays there (DESIGN.md §15 "Open on the web") and
 * "Forgot password?". EXPO_PUBLIC_WEB_URL when set; otherwise derived from
 * the API URL: https://api.example.com → https://example.com, and a local API
 * on :8000 → the web on :3000. */
export function webUrl(api: string = apiUrl(), raw: string | undefined = process.env.EXPO_PUBLIC_WEB_URL): string {
  const explicit = (raw ?? "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const u = new URL(api);
  if (u.hostname.startsWith("api.")) u.hostname = u.hostname.slice(4);
  if (u.port === "8000") u.port = "3000";
  return u.origin;
}
