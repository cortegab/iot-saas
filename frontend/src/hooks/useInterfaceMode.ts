"use client";

import { useCallback } from "react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import type { components } from "@/types/api";

type ViewResponse = components["schemas"]["ViewResponse"];
export type InterfaceMode = ViewResponse["interface_mode"];

/**
 * This person's view of the current workspace (DESIGN.md §15a Simple view):
 * Simple hides and rewords, it grants nothing (the API still checks roles).
 * Until the server answers, Full is assumed, so nothing flashes away for the
 * people who set things up; a Viewer's Simple view arrives with the first load.
 */
export function useInterfaceMode(): { mode: InterfaceMode; simple: boolean; chosen: boolean; setMode: (mode: InterfaceMode | null) => Promise<void> } {
  const api = useApi();
  const { data, mutate } = useApiSWR<ViewResponse>("/tenants/current/view", { revalidateOnFocus: false });
  const mode: InterfaceMode = data?.interface_mode ?? "full";
  const setMode = useCallback(
    async (next: InterfaceMode | null) => {
      if (next) void mutate({ interface_mode: next, chosen: true }, { revalidate: false });
      const saved = await api.patch<ViewResponse>("/tenants/current/view", { interface_mode: next });
      void mutate(saved, { revalidate: false });
    },
    [api, mutate],
  );
  return { mode, simple: mode === "simple", chosen: data?.chosen ?? false, setMode };
}
