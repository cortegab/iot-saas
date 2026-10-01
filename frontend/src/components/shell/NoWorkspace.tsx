"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { AuthCard, AuthScreen } from "@/components/auth/AuthCard";
import { useAuth } from "@/hooks/useAuth";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";

/** Signed in but in no workspace — after leaving the last one, or after
 * being removed. Create one, or wait for an invite. */
export function NoWorkspace() {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <AuthScreen>
      <AuthCard
        title="You're not in a workspace"
        description="Create one to connect devices, or open the invite link a teammate sent you."
        footer={
          <button type="button" onClick={() => void logout()} className="font-medium text-accent hover:underline">
            Sign out
          </button>
        }
      >
        <Button onClick={() => setOpen(true)} className="h-11 w-full text-[15px]">
          Create a workspace
        </Button>
      </AuthCard>
      <CreateWorkspaceDialog open={open} onClose={() => setOpen(false)} />
    </AuthScreen>
  );
}
