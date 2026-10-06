"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { buttonClassName } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/** The landing page's sign-in action. A visitor who is already signed in
 * gets "Open console" instead of a login form they don't need — the label
 * always says where it goes. */
export function EnterButton({ variant = "primary", className }: { variant?: "primary" | "secondary" | "ghost"; className?: string }) {
  const { status } = useAuth();
  const authenticated = status === "authenticated";
  return (
    <Link href={authenticated ? "/devices" : "/login"} className={cn(buttonClassName({ variant }), className)}>
      {authenticated ? "Open console" : "Sign in"}
    </Link>
  );
}
