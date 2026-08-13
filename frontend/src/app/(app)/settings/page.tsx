"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Settings has no single flat page anymore — Organization/Users/Roles &
 * Permissions/API-Tokens are separate routes (see PrimaryNav). This bare
 * `/settings` just forwards to the first one. */
export default function SettingsIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings/organization");
  }, [router]);
  return null;
}
