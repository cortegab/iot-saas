"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentUser } from "@/hooks/useCurrentUser";

function initialsFor(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

export function UserMenu() {
  const { data: user } = useCurrentUser();
  const { memberships, currentTenantId, logout } = useAuth();
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
        {user ? initialsFor(user.email) : "…"}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close account menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-border bg-surface p-1 shadow-lg">
            <div className="border-b border-border px-3 py-2">
              {tenantName && <p className="text-sm font-medium text-ink">{tenantName}</p>}
              {user && <p className="truncate text-xs text-ink-muted">{user.email}</p>}
            </div>
            <button
              type="button"
              onClick={() => void logout().then(() => router.replace("/login"))}
              className="mt-1 w-full rounded-md px-3 py-2 text-left text-sm text-ink-muted hover:bg-surface-raised hover:text-ink"
            >
              Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
