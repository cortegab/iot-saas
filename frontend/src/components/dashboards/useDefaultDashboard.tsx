"use client";

import { mutate as revalidate } from "swr";
import { Home } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type DashboardResponse = components["schemas"]["DashboardResponse"];

/** Deleting the default says so first (DESIGN.md §8). */
export const defaultNote = (d: DashboardResponse) => (d.is_default ? "It's your default dashboard; you'll land on the one you opened last. " : "");

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
        toast({ title: `${d.name} is no longer your default`, detail: "You'll land on the dashboard you opened last." });
      } else {
        await api.put(`/dashboards/${d.id}/default`);
        toast({ title: `${d.name} is your default dashboard`, detail: "You'll land here after signing in." });
      }
      void revalidate((key) => typeof key === "string" && key.startsWith("/dashboards"));
    } catch (err) {
      toast({ tone: "error", title: "Couldn't change your default dashboard", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  /** The row / page menu item. */
  const item = (d: DashboardResponse): DropdownMenuItem => ({
    label: d.is_default ? "Remove as default" : "Set as default",
    icon: <Home size={15} />,
    onClick: () => void toggle(d),
  });

  return { toggle, item };
}
