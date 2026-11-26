"use client";

import { mutate as revalidate } from "swr";
import { Home } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";

type DashboardResponse = components["schemas"]["DashboardResponse"];

/** Deleting the default says so first (DESIGN.md §8). */
export const defaultNote = (d: DashboardResponse) => (d.is_default ? tr("wsheet.defaultNote") : "");

/** Set as default / Remove as default (DESIGN.md §8): the one dashboard a
 * person lands on after signing in. Per person per workspace, like dashboards
 * themselves. */
export function useDefaultDashboard() {
  const api = useApi();
  const toast = useToast();

  async function toggle(d: DashboardResponse) {
    try {
      if (d.is_default) {
        await api.delete(`/dashboards/${d.id}/default`);
        toast({ title: tr("wsheet.noLongerDefault", { name: d.name }), detail: tr("wsheet.noLongerDefaultDetail") });
      } else {
        await api.put(`/dashboards/${d.id}/default`);
        toast({ title: tr("wsheet.isDefault", { name: d.name }), detail: tr("wsheet.isDefaultDetail") });
      }
      void revalidate((key) => typeof key === "string" && key.startsWith("/dashboards"));
    } catch (err) {
      toast({ tone: "error", title: tr("wsheet.defaultFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  /** The row / page menu item. */
  const item = (d: DashboardResponse): DropdownMenuItem => ({
    label: d.is_default ? tr("wsheet.removeDefault") : tr("wsheet.setDefault"),
    icon: <Home size={15} />,
    onClick: () => void toggle(d),
  });

  return { toggle, item };
}
