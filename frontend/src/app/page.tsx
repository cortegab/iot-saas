"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

/** Pure redirect gateway — Devices is the default destination for a returning
 * user (UX_UI_Description.md's information architecture), Login otherwise. */
export default function Home() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace("/devices");
    else if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  return <div className="flex min-h-screen items-center justify-center text-ink-muted">Loading…</div>;
}
