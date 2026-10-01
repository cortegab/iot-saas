/** Only an in-app path may be a `?next=` redirect target. */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/devices";
}
