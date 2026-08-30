"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

/** The landing page's primary action. An already-signed-in visitor lands here
 * too (e.g. from a bookmark) — send them to the console instead of a login form
 * they don't need. The label follows the destination so the button never lies
 * about what it does. */
export function EnterButton({
  variant = "primary",
  className,
}: {
  variant?: "primary" | "ghost";
  className?: string;
}) {
  const { status } = useAuth();
  const authenticated = status === "authenticated";

  return (
    <Link
      href={authenticated ? "/devices" : "/login"}
      className={`mkt-btn ${variant === "ghost" ? "mkt-btn--ghost" : ""} ${className ?? ""}`.trim()}
    >
      {authenticated ? "Open console" : "Log in"}
      <span aria-hidden="true">→</span>
    </Link>
  );
}
