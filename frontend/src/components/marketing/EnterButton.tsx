"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { HOME } from "@/lib/landing";
import { nightButtonClassName } from "./night";
import { marketingCopy } from "@/lib/marketing-copy";
import { useLocale } from "@/lib/i18n";

/** The landing page's sign-in action, on the night surfaces. A visitor who is
 * already signed in gets "Open console" instead of a login form they don't
 * need — the label always says where it goes. */
export function EnterButton({ size = "md" }: { size?: "md" | "lg" }) {
  const { status } = useAuth();
  const authenticated = status === "authenticated";
  const c = marketingCopy(useLocale());
  return (
    <Link href={authenticated ? HOME : "/login"} className={nightButtonClassName({ kind: "ghost", size })}>
      {authenticated ? c.nav.openConsole : c.nav.signIn}
    </Link>
  );
}
