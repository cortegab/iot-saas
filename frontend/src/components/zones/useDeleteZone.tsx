"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { mutate as revalidate } from "swr";
import { useApi } from "@/hooks/useApi";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type ZoneResponse = components["schemas"]["ZoneResponse"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Delete a zone, blocked with an explanation while devices are in it
 * (DESIGN.md §7). Shared by the zone's peek and its page. */
export function useDeleteZone(onDeleted: () => void) {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();

  async function remove(zone: ZoneResponse) {
    if (zone.device_count > 0) {
      const go = await confirm(`${plural(zone.device_count, "device is", "devices are")} assigned to it. Move them to another zone from their settings first.`, {
        title: `${zone.name} is in use`,
        confirmLabel: "View devices",
        cancelLabel: "Close",
        danger: false,
      });
      if (go) router.push(`/devices?zone=${zone.id}`);
      return;
    }
    if (!(await confirm("No devices are assigned to it.", { title: `Delete ${zone.name}?`, confirmLabel: "Delete zone" }))) return;
    try {
      await api.delete(`/zones/${zone.id}`);
      void revalidate("/zones");
      toast({ title: `${zone.name} deleted` });
      onDeleted();
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete the zone", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  // The record menu's Delete item (DESIGN.md §7), the same in the list row,
  // the peek and the zone's page: still offered while devices are in the
  // zone, with their count as the hint — picking it explains the block.
  const menuItem = (zone: ZoneResponse): DropdownMenuItem => ({
    label: "Delete…",
    icon: <Trash2 size={15} />,
    danger: true,
    hint: zone.device_count ? `${plural(zone.device_count, "device is", "devices are")} in it` : undefined,
    onClick: () => void remove(zone),
  });

  return { remove, dialog, menuItem };
}
