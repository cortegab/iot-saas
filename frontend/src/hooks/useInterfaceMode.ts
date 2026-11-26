"use client";

import { useCallback, useEffect } from "react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";
import type { components } from "@/types/api";

type ViewResponse = components["schemas"]["ViewResponse"];
export type InterfaceMode = ViewResponse["interface_mode"];

const KEY = "iod.view.";

function remembered(tenantId: string | null): InterfaceMode | null {
  if (!tenantId || typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(KEY + tenantId);
    return v === "simple" || v === "full" ? v : null;
  } catch {
    return null;
  }
}

function remember(tenantId: string | null, mode: InterfaceMode): void {
  if (!tenantId) return;
  try {
    window.localStorage.setItem(KEY + tenantId, mode);
  } catch {
    // A convenience only: the server holds the choice.
  }
}

/**
 * This person's view of the current workspace (DESIGN.md §15a Simple view):
 * Simple hides and rewords, it grants nothing (the API still checks roles).
 * Until the server answers, the view last seen in this browser is used, else
 * the role's default (Viewer: Simple), so nothing flashes in and away.
 * A switch shows at once and goes back, with a toast, if it can't be saved.
 */
export function useInterfaceMode(): { mode: InterfaceMode; simple: boolean; chosen: boolean; setMode: (mode: InterfaceMode | null) => Promise<void> } {
  const api = useApi();
  const toast = useToast();
  const { currentTenantId } = useAuth();
  const { role } = usePermissions();
  const { data, mutate } = useApiSWR<ViewResponse>("/tenants/current/view", { revalidateOnFocus: false });
  const mode: InterfaceMode = data?.interface_mode ?? remembered(currentTenantId) ?? (role === "viewer" ? "simple" : "full");
  const served = data?.interface_mode;
  useEffect(() => {
    if (served) remember(currentTenantId, served);
  }, [currentTenantId, served]);

  const setMode = useCallback(
    async (next: InterfaceMode | null) => {
      const before = data;
      if (next) void mutate({ interface_mode: next, chosen: true }, { revalidate: false });
      try {
        const saved = await api.patch<ViewResponse>("/tenants/current/view", { interface_mode: next });
        remember(currentTenantId, saved.interface_mode);
        void mutate(saved, { revalidate: false });
      } catch {
        void mutate(before, { revalidate: !before });
        toast({ tone: "error", title: "Couldn't change the view", detail: "It's back as it was. Try again." });
      }
    },
    [api, currentTenantId, data, mutate, toast],
  );
  return { mode, simple: mode === "simple", chosen: data?.chosen ?? false, setMode };
}
