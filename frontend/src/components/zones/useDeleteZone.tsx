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
import { tActive as tr } from "@iodriven/shared/i18n";

type ZoneResponse = components["schemas"]["ZoneResponse"];


/** Delete a zone, blocked with an explanation while devices are in it
 * (DESIGN.md §7). Shared by the zone's peek and its page. */
export function useDeleteZone(onDeleted: () => void) {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();

  async function remove(zone: ZoneResponse) {
    if (zone.device_count > 0) {
      const go = await confirm(tr("zone.inUseBody", { count: zone.device_count }), {
        title: tr("zone.inUseTitle", { zone: zone.name }),
        confirmLabel: tr("zone.viewDevices"),
        cancelLabel: tr("zone.close"),
        danger: false,
      });
      if (go) router.push(`/devices?zone=${zone.id}`);
      return;
    }
    if (!(await confirm(tr("zone.deleteBody"), { title: tr("zone.deleteTitle", { zone: zone.name }), confirmLabel: tr("zone.deleteConfirm") }))) return;
    try {
      await api.delete(`/zones/${zone.id}`);
      void revalidate("/zones");
      toast({ title: tr("zone.deleted", { zone: zone.name }) });
      onDeleted();
    } catch (err) {
      toast({ tone: "error", title: tr("zone.deleteFailed"), detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  // The record menu's Delete item (DESIGN.md §7), the same in the list row,
  // the peek and the zone's page: still offered while devices are in the
  // zone, with their count as the hint — picking it explains the block.
  const menuItem = (zone: ZoneResponse): DropdownMenuItem => ({
    label: tr("zone.delete"),
    icon: <Trash2 size={15} />,
    danger: true,
    hint: zone.device_count ? tr("zone.inIt", { count: zone.device_count }) : undefined,
    onClick: () => void remove(zone),
  });

  return { remove, dialog, menuItem };
}
