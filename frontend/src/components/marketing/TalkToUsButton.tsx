"use client";

import { useState, type ReactNode } from "react";
import { TalkToUsDialog } from "./TalkToUsDialog";

/** Opens the "Talk to us" contact form (POST /public/contact) from anywhere
 * on the landing page: the header, the hero and the closing band. */
export function TalkToUsButton({ className, children }: { className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      <TalkToUsDialog open={open} onClose={() => setOpen(false)} deployment="not_sure" />
    </>
  );
}
