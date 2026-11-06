/** Where the API is: EXPO_PUBLIC_API_URL, inlined at build time (eas.json per
 * build profile, mobile/.env locally). No trailing slash. */
export function apiUrl(raw: string | undefined = process.env.EXPO_PUBLIC_API_URL): string {
  const url = (raw ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+/.test(url)) {
    throw new Error("EXPO_PUBLIC_API_URL is missing or not an http(s) URL. Set it in mobile/.env (see .env.example).");
  }
  return url;
}
