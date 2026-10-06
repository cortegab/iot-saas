"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { nightButtonClassName } from "./night";

/** The landing page's sign-in action, on the night surfaces. A visitor who is
 * already signed in gets "Open console" instead of a login form they don't
 * need — the label always says where it goes. */
export function EnterButton({ size = "md" }: { size?: "md" | "lg" }) {
  const { status } = useAuth();
  const authenticated = status === "authenticated";
  return (
    <Link href={authenticated ? "/devices" : "/login"} className={nightButtonClassName({ kind: "ghost", size })}>
      {authenticated ? "Open console" : "Sign in"}
    </Link>
  );
}
