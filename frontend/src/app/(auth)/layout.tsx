"use client";

import { Suspense, useEffect, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { AuthScreen } from "@/components/auth/AuthCard";
import { safeNext } from "@/lib/safe-next";

// useSearchParams() needs a Suspense boundary, or `next build` refuses to
// prerender the page (`pnpm dev` doesn't check, so it only fails in prod).
// This one boundary also covers the pages below that read the query
// themselves (login's ?next, reset-password's ?token).
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AuthGate>{children}</AuthGate>
    </Suspense>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, router, next]);

  if (status === "authenticated") return null;

  return <AuthScreen>{children}</AuthScreen>;
}
