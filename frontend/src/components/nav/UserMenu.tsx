"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { TenantSwitcher } from "@/components/nav/TenantSwitcher";

function initialsFor(name: string | null | undefined, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return (first + last).toUpperCase() || email.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

/** Account identity + tenant switching + logout, all in one dropdown — the
 * sidebar footer used to duplicate the tenant switcher and a second "Log out"
 * button; this is the single source of both now. Renders through the shared
 * `DropdownMenu` shell (portaled + `fixed`-positioned) instead of its own
 * `absolute`-positioned panel, so it can't get clipped the way the old
 * hand-rolled version could. */
export function UserMenu() {
  const { data: user } = useCurrentUser();
  const { memberships, currentTenantId, setCurrentTenantId, logout } = useAuth();
  const router = useRouter();

  const tenantName = memberships.find((m) => m.tenant_id === currentTenantId)?.tenant_name;

  return (
    <DropdownMenu
      label="Account menu"
      panelClassName="w-64 p-1"
      triggerClassName="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      trigger={user ? initialsFor(user.name, user.email) : "…"}
    >
      <div className="border-b border-border px-3 py-2">
        {user?.name && <p className="text-sm font-medium text-ink">{user.name}</p>}
        {user && <p className="truncate text-xs text-ink-muted">{user.email}</p>}
        {tenantName && <p className="mt-1 truncate text-xs text-ink-muted">{tenantName}</p>}
      </div>

      {currentTenantId && (
        <div className="border-b border-border px-1 py-1">
          <TenantSwitcher
            memberships={memberships}
            currentTenantId={currentTenantId}
            onSwitch={setCurrentTenantId}
          />
        </div>
      )}

      <button
        type="button"
        onClick={() => void logout().then(() => router.replace("/login"))}
        className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink-muted hover:bg-surface-raised hover:text-ink"
      >
        <LogOut aria-hidden size={16} />
        Log out
      </button>
    </DropdownMenu>
  );
}
