import type { ReactNode } from "react";
import Link from "next/link";
import { NetworkCanvas } from "@/components/marketing/NetworkCanvas";

/** The centred sign-in card (demo G `.auth-card`) used by the account pages:
 * login, register, forgot/reset password, invitation. */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-4">
      <Link href="/" className="flex items-center justify-center gap-2 text-[17px] font-bold tracking-[-0.01em] text-ink">
        <span aria-hidden className="h-[18px] w-[18px] rounded-[5px] bg-[linear-gradient(135deg,var(--color-accent),var(--color-chart))]" />
        iodriven
      </Link>
      <div className="flex w-full flex-col gap-3.5 rounded-2xl border border-border bg-surface p-6 shadow-pop sm:p-8">
        <div>
          <h1 className="text-[25px] font-semibold tracking-[-0.025em] text-ink">{title}</h1>
          {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
        </div>
        {children}
        {footer && <div className="border-t border-border pt-3 text-center text-[13.5px] text-ink-muted">{footer}</div>}
      </div>
    </div>
  );
}

/** The account pages' screen (DESIGN.md §10): the landing's network canvas
 * as a branded background — never an empty page — with the card centred. */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4 py-10">
      <NetworkCanvas className="absolute inset-0 h-full w-full opacity-50" density={0.8} />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,var(--color-canvas)_0%,transparent_70%)]" />
      <div className="relative w-full max-w-[410px]">{children}</div>
    </main>
  );
}
