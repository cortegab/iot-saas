import type { components } from "@/types/api";

type MembershipSummary = components["schemas"]["MembershipSummary"];

export interface TenantSwitcherProps {
  memberships: MembershipSummary[];
  currentTenantId: string;
  onSwitch: (tenantId: string) => void;
}

/**
 * A fresh account has exactly one tenant (auto-created at registration), so the
 * common case has nothing to switch between — render nothing rather than a
 * single-option picker (UX_UI_Description.md: minimal clicks, low cognitive load).
 */
export function TenantSwitcher({ memberships, currentTenantId, onSwitch }: TenantSwitcherProps) {
  if (memberships.length <= 1) return null;

  return (
    <label className="flex flex-col gap-1 px-4 py-2 text-xs text-ink-muted">
      <span className="uppercase tracking-wide">Workspace</span>
      <select
        value={currentTenantId}
        onChange={(e) => onSwitch(e.target.value)}
        className="rounded-md border border-border bg-surface-raised px-2 py-1 text-sm text-ink"
      >
        {memberships.map((m) => (
          <option key={m.tenant_id} value={m.tenant_id}>
            {m.tenant_name}
          </option>
        ))}
      </select>
    </label>
  );
}
