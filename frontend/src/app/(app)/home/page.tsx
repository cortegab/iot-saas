"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useAuth } from "@/hooks/useAuth";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { landingPath, readLastDashboard } from "@/lib/landing";
import type { components } from "@/types/api";

type LandingResponse = components["schemas"]["LandingResponse"];

/** Where every entry point lands (DESIGN.md §4 Landing): asks the API once
 * and replaces the URL, so Back never returns here. If the API can't answer,
 * Devices is always there. */
export default function HomePage() {
  const router = useRouter();
  const { currentTenantId } = useAuth();
  const { data, error } = useApiSWR<LandingResponse>("/tenants/current/landing", { revalidateOnFocus: false });

  useEffect(() => {
    if (error) router.replace("/devices");
    else if (data && currentTenantId) router.replace(landingPath(data, readLastDashboard(currentTenantId)));
  }, [data, error, currentTenantId, router]);

  return (
    <div aria-busy="true" aria-label="Opening your workspace">
      <LoadingSkeleton rows={4} rowClassName="h-16" />
    </div>
  );
}
