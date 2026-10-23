"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Pencil, Power, SquareArrowOutUpRight, Trash2, Wrench } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { usePermissions } from "@/hooks/usePermissions";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { SecretReveal } from "@/components/ui/SecretReveal";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A device's record actions (rotate, enable/disable, delete) and its ⋯ menu,
 * shared by the devices list, its peek and the device page so each offers
 * the same items with the same confirmations (DESIGN.md §6 record menu). */
export function useDeviceActions({
  onChanged,
  ruleCount,
}: {
  /** Re-fetch whatever shows the devices once one changes. */
  onChanged: () => Promise<unknown>;
  /** How many rules use a device, for the delete confirmation. */
  ruleCount: (deviceId: string) => number;
}) {
  const router = useRouter();
  const api = useApi();
  const toast = useToast();
  const { can } = usePermissions();
  const canWrite = can("devices.write");
  const { confirm, dialog } = useConfirm();
  const [revealed, setRevealed] = useState<{ name: string; credential: DeviceCreateResponse["credential"] } | null>(null);

  async function setEnabled(targets: DeviceResponse[], enabled: boolean, undoable = true) {
    try {
      for (const d of targets) await api.patch(`/devices/${d.id}`, { status: enabled ? "active" : "disabled" });
      await onChanged();
      toast({
        title:
          targets.length === 1
            ? `${targets[0].name} ${enabled ? "enabled" : "disabled"}`
            : `${plural(targets.length, "device")} ${enabled ? "enabled" : "disabled"}`,
        detail: enabled
          ? "Rules evaluate them again from the next reading."
          : "Rules stop evaluating them and they can't connect. Telemetry history is kept.",
        action: undoable ? { label: "Undo", onClick: () => void setEnabled(targets, !enabled, false) } : undefined,
      });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't update the device", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  /** Resolves true once the devices are deleted. `gone` runs before the
   * re-fetch, so a page showing the device can leave first. */
  async function remove(targets: DeviceResponse[], gone?: () => void): Promise<boolean> {
    const rules = targets.reduce((n, d) => n + ruleCount(d.id), 0);
    const one = targets.length === 1;
    const ok = await confirm(
      <p>
        {one ? "Its credential stops" : "Their credentials stop"} working immediately
        {rules > 0 && (
          <>
            , <strong>{plural(rules, "rule")}</strong> stop evaluating {one ? "it" : "them"}
          </>
        )}
        , and {one ? "its" : "their"} telemetry history is removed. This can&apos;t be undone. To pause{" "}
        {one ? "it" : "them"} instead, disable {one ? "it" : "them"}.
      </p>,
      {
        title: one ? `Delete ${targets[0].name}?` : `Delete ${plural(targets.length, "device")}?`,
        confirmLabel: one ? "Delete device" : `Delete ${plural(targets.length, "device")}`,
        details: one ? undefined : (
          <ul>
            {targets.map((d) => (
              <li key={d.id} className="font-mono">
                {d.name}
              </li>
            ))}
          </ul>
        ),
      },
    );
    if (!ok) return false;
    try {
      for (const d of targets) await api.delete(`/devices/${d.id}`);
      toast({ title: one ? `${targets[0].name} deleted` : `${plural(targets.length, "device")} deleted` });
      gone?.();
      await onChanged();
      return true;
    } catch (err) {
      toast({ tone: "error", title: "Couldn't delete", detail: err instanceof ApiRequestError ? err.message : undefined });
      await onChanged();
      return false;
    }
  }

  async function rotate(d: DeviceResponse) {
    const ok = await confirm(
      d.connection_state === "never_connected"
        ? "A new credential is issued and the old one stops working."
        : "The firmware running now disconnects until you flash it with the new credential.",
      { title: `Rotate the credential for ${d.name}?`, confirmLabel: "Rotate credential" },
    );
    if (!ok) return;
    try {
      const result = await api.post<DeviceCreateResponse>(`/devices/${d.id}/rotate-credential`);
      setRevealed({ name: d.name, credential: result.credential });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't rotate the credential", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  /** The ⋯ menu. `where` drops what that place already shows: a peek has its
   * own Open device button; the device's page is already open and has a
   * Settings tab. `onDeleted` runs after a delete (close the peek, leave the
   * page). */
  function menu(d: DeviceResponse, opts: { where?: "list" | "peek" | "page"; onDeleted?: () => void } = {}): DropdownMenuItem[][] {
    const where = opts.where ?? "list";
    const open: DropdownMenuItem[] =
      where === "list" ? [{ label: "Open device", icon: <SquareArrowOutUpRight size={15} />, onClick: () => router.push(`/devices/${d.id}`) }] : [];
    if (!canWrite) return open.length ? [open] : [];
    const never = d.connection_state === "never_connected";
    return [
      [
        ...open,
        ...(where === "page" ? [] : [{ label: "Edit settings", icon: <Pencil size={15} />, onClick: () => router.push(`/devices/${d.id}?tab=settings`) }]),
        { label: never ? "Connect…" : "Install or reconnect…", icon: <Wrench size={15} />, onClick: () => router.push(`/devices/${d.id}/connect`) },
        { label: "Rotate credential…", icon: <KeyRound size={15} />, onClick: () => void rotate(d) },
        { label: d.status === "active" ? "Disable" : "Enable", icon: <Power size={15} />, onClick: () => void setEnabled([d], d.status !== "active") },
      ],
      [{ label: "Delete…", icon: <Trash2 size={15} />, danger: true, onClick: () => void remove([d], opts.onDeleted) }],
    ];
  }

  /** The new credential after a rotate, shown once. Render it at the top of the page. */
  const reveal: ReactNode = revealed ? (
    <SecretReveal
      title={`New credential for ${revealed.name}`}
      fields={[
        { label: "username", value: revealed.credential.username },
        { label: "password", value: revealed.credential.password, secret: true },
      ]}
      copyLabel="Copy credential"
      onDismiss={() => setRevealed(null)}
    />
  ) : null;

  return { setEnabled, remove, rotate, menu, reveal, dialog, canWrite };
}
