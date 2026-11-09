"use client";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { FactList } from "@/components/ui/FactList";
import { useToast } from "@/components/ui/Toast";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type FirmwareStatus = components["schemas"]["FirmwareStatusResponse"];

/** What an update is doing, in words (firmware/src/ota.h's states). */
function progress(s: FirmwareStatus): { text: string; tone: "pending" | "error" | null } | null {
  const state = s.state;
  if (s.target && s.current === s.target) return { text: `Updated to ${s.target}.`, tone: null };
  if (state?.state === "failed") return { text: `The update to ${state.version} failed: ${state.error ?? "no reason given"}.`, tone: "error" };
  if (state?.state === "rolled_back")
    return { text: `${state.version} was installed but didn't reach the broker, so the device went back to ${s.current}.`, tone: "error" };
  if (state?.state === "downloading") return { text: `Downloading ${state.version}…`, tone: "pending" };
  if (state?.state === "restarting") return { text: `Restarting into ${state.version}…`, tone: "pending" };
  if (s.target && s.target !== s.current) return { text: `Update to ${s.target} sent. Waiting for the device…`, tone: "pending" };
  return null;
}

/** Over-the-air updates (generic firmware 1.0.0+, docs/firmware/ota.md):
 * what the device runs, the latest release, and Update to … for admins. */
export function FirmwareSection({ deviceId, readOnly }: { deviceId: string; readOnly: boolean }) {
  const api = useApi();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { data, mutate } = useApiSWR<FirmwareStatus>(`/devices/${deviceId}/firmware`, {
    // While an update runs, look again every few seconds.
    refreshInterval: (latest) => (latest?.target && latest.target !== latest.current && latest.state?.state !== "failed" && latest.state?.state !== "rolled_back" ? 5000 : 0),
  });
  if (!data) return null;
  const line = progress(data);

  async function update(version: string) {
    const ok = await confirm(
      "The device downloads it, checks its signature, and restarts into it, which takes about a minute. Its outputs go to their boot state while it restarts. If the new version can't reach the broker within 2 minutes, it goes back to the one it has.",
      { title: `Update to ${version}?`, confirmLabel: `Update to ${version}` },
    );
    if (!ok) return;
    try {
      await mutate(await api.post<FirmwareStatus>(`/devices/${deviceId}/firmware/update`, { version }), { revalidate: false });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't send the update", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  return (
    <>
      <FactList
        facts={[
          ["Running", data.current ?? <span key="c" className="text-ink-muted">Not reported yet</span>],
          data.latest != null && [
            "Latest release",
            <span key="l" className="flex flex-wrap items-center gap-x-2">
              <span>{data.latest}</span>
              {!readOnly && data.can_update && data.latest && (
                <Button variant="link" className="text-meta" onClick={() => void update(data.latest!)}>
                  Update to {data.latest}…
                </Button>
              )}
            </span>,
          ],
          line != null && [
            "Update",
            <span key="u" className={line.tone === "error" ? "text-status-error" : line.tone === "pending" ? "text-status-pending" : undefined}>
              {line.text}
            </span>,
          ],
          data.update_available && !data.can_update && data.reason != null && ["Over the air", <span key="r" className="text-ink-muted">{data.reason}</span>],
        ]}
      />
      {dialog}
    </>
  );
}
