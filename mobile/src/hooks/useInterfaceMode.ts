import type { components } from "@iodriven/shared/api";
import { useCallback } from "react";
import { useApi } from "./useApi";
import { useApiSWR } from "./useApiSWR";

type ViewResponse = components["schemas"]["ViewResponse"];

/** This person's view of the workspace, the web's useInterfaceMode
 * (DESIGN.md §15a): Simple hides and rewords, it grants nothing. Full until
 * the server answers. The choice is shared with the web (one per workspace). */
export function useInterfaceMode() {
  const api = useApi();
  const { data, mutate } = useApiSWR<ViewResponse>("/tenants/current/view");
  const simple = data?.interface_mode === "simple";
  const setSimple = useCallback(
    async (next: boolean) => {
      void mutate({ interface_mode: next ? "simple" : "full", chosen: true }, { revalidate: false });
      const saved = await api.patch<ViewResponse>("/tenants/current/view", { interface_mode: next ? "simple" : "full" });
      void mutate(saved, { revalidate: false });
    },
    [api, mutate],
  );
  return { simple, setSimple };
}
