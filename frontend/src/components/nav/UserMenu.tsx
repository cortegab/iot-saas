"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentUser } from "@/hooks/useCurrentUser";
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
 * button; this is the single source of both now. */
export function UserMenu() {
  const { data: user } = useCurrentUser();
  const { memberships, currentTenantId, setCurrentTenantId, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const tenantName = memberships.find((m) => m.tenant_id === currentTenantId)?.tenant_name;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-medium text-white"
      >
        {user ? initialsFor(user.name, user.email) : "…"}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close account menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-border bg-surface p-1 shadow-lg">
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
          </div>
        </>
      )}
    </div>
  );
}
