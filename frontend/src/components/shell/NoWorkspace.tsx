"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { AuthCard, AuthScreen } from "@/components/auth/AuthCard";
import { useAuth } from "@/hooks/useAuth";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { useT } from "@/lib/i18n";

/** Signed in but in no workspace — after leaving the last one, or after
 * being removed. Create one, or wait for an invite. */
export function NoWorkspace() {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const t = useT();
  return (
    <AuthScreen>
      <AuthCard
        title={t("noWorkspace.title")}
        description={t("noWorkspace.description")}
        footer={
          <button type="button" onClick={() => void logout()} className="font-medium text-accent hover:underline">
            {t("common.signOut")}
          </button>
        }
      >
        <Button onClick={() => setOpen(true)} className="w-full">
          {t("noWorkspace.create")}
        </Button>
      </AuthCard>
      <CreateWorkspaceDialog open={open} onClose={() => setOpen(false)} />
    </AuthScreen>
  );
}
