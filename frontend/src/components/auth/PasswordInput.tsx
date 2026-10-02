"use client";

import { forwardRef, useState, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/Input";

/** A password field with Show / Hide (DESIGN.md §10 sign-in). Reports Caps
 * Lock through `onCapsLock` so a page can hint when it matters (after
 * failed attempts), rather than nagging on every keystroke. */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { onCapsLock?: (on: boolean) => void }
>(function PasswordInput({ onCapsLock, onKeyUp, onKeyDown, "aria-label": ariaLabel = "Password", ...props }, ref) {
  const [shown, setShown] = useState(false);
  const caps = (e: KeyboardEvent<HTMLInputElement>) => onCapsLock?.(e.getModifierState?.("CapsLock") ?? false);
  return (
    <div className="relative">
      <Input
        ref={ref}
        {...props}
        aria-label={ariaLabel}
        type={shown ? "text" : "password"}
        className="pr-11"
        onKeyUp={(e) => {
          caps(e);
          onKeyUp?.(e);
        }}
        onKeyDown={(e) => {
          caps(e);
          onKeyDown?.(e);
        }}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink"
      >
        {shown ? <EyeOff aria-hidden size={16} /> : <Eye aria-hidden size={16} />}
      </button>
    </div>
  );
});
