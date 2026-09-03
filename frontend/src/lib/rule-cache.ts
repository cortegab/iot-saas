import { mutate } from "swr";
import type { components } from "@/types/api";

type RuleResponse = components["schemas"]["RuleResponse"];

/**
 * Write a just-saved rule into SWR's cache so the `/rules` list (and each of
 * the rule's device rule-lists) is correct *before* those pages remount —
 * `mutate(key)` alone is a no-op for a key with no live subscriber, which is
 * exactly the case while the editor is open. A data-carrying `mutate` runs the
 * populateCache path regardless, and `revalidate: true` still refetches once a
 * page mounts.
 */
export function upsertRuleInCache(saved: RuleResponse): void {
  void mutate<RuleResponse[]>(
    "/rules",
    (list) =>
      [...(list ?? []).filter((r) => r.id !== saved.id), saved].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    { revalidate: true },
  );
  for (const d of saved.devices) {
    void mutate(`/devices/${d.device_id}/rules`, undefined, { revalidate: true });
  }
}
