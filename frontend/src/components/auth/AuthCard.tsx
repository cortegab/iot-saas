import type { ReactNode } from "react";
import Link from "next/link";

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

/** Full-screen canvas for account pages outside the (auth) layout. */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas bg-[radial-gradient(circle_at_100%_0%,color-mix(in_srgb,var(--color-accent)_12%,transparent),transparent_42%),radial-gradient(circle_at_0%_100%,color-mix(in_srgb,var(--color-chart)_9%,transparent),transparent_40%)] px-4 py-10">
      <div className="w-full max-w-[410px]">{children}</div>
    </main>
  );
}
