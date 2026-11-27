import type { ReactNode } from "react";
import Link from "next/link";
import { RuleLoopCard } from "@/components/marketing/RuleLoopCard";
import { BrandMark } from "@/components/brand/BrandMark";
import { useT } from "@/lib/i18n";

/** The sign-in card (demo G `.auth-card`) used by the account pages: login,
 * register, forgot/reset password, invitation. */
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
    <div className="flex w-full flex-col gap-3.5 rounded-2xl border border-border bg-surface px-5 py-6 shadow-pop sm:p-8">
      <div>
        <h1 className="text-title font-semibold tracking-[-0.015em] text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {children}
      {footer && <div className="border-t border-border pt-3 text-center text-meta text-ink-muted">{footer}</div>}
    </div>
  );
}

/** The account pages' screen (DESIGN.md §10): a night brand panel (the
 * landing's three lines, the live rule card and the design figures) beside
 * the card. Below `lg` the panel becomes a band above the card with the
 * lines only; the rule card also steps aside on short screens. */
export function AuthScreen({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.15fr)_minmax(440px,1fr)]">
      <section
        aria-label={t("auth.side.about")}
        className="night-bg relative flex flex-col gap-[18px] overflow-hidden px-5 pb-6 pt-6 text-night-ink lg:min-h-screen lg:gap-[22px] lg:px-11 lg:pb-7 lg:pt-8"
      >
        <Link href="/" className="flex w-fit items-center gap-2.5 text-[18px] font-bold tracking-[-0.01em] text-white">
          <BrandMark />
          IO Driven
        </Link>
        <div className="max-w-[31rem] lg:mt-[3vh]">
          <p className="mb-3.5 font-mono text-xs uppercase tracking-[0.14em] text-night-sky">{t("auth.side.eyebrow")}</p>
          <h2 className="text-balance text-[26px] font-semibold leading-[1.06] tracking-[-0.035em] text-white lg:text-[clamp(28px,3vw,40px)]">
            {t("auth.side.line1")} <span className="text-[#93a4bd] lg:block">{t("auth.side.line2")}</span>{" "}
            <span className="text-[#93a4bd] lg:block">{t("auth.side.line3")}</span>
          </h2>
          <p className="mt-2 max-w-[44ch] text-sm leading-[1.6] text-night-muted lg:mt-4 lg:text-section">{t("auth.side.body")}</p>
        </div>
        <RuleLoopCard className="max-w-[470px] max-lg:hidden [@media(max-height:720px)]:hidden" />
        <dl className="m-0 mt-auto hidden max-w-[38rem] grid-cols-3 gap-4 border-t border-night-line pt-[18px] lg:grid">
          {[
            [t("auth.side.breach"), "< 2 s"],
            [t("auth.side.typical"), "< 500 ms"],
            [t("auth.side.perHost"), "500–1,000"],
          ].map(([dt, dd]) => (
            <div key={dt}>
              <dt className="text-xs text-night-dim">{dt}</dt>
              <dd className="mt-[3px] font-mono text-[21px] text-white tabular-nums">{dd}</dd>
            </div>
          ))}
        </dl>
      </section>
      <main className="auth-wash flex flex-col items-center justify-center gap-7 bg-canvas px-4 py-7 lg:px-6 lg:py-10">
        <div className="w-full max-w-[410px]">{children}</div>
        <p className="flex flex-wrap justify-center gap-4 text-xs text-ink-muted">
          <Link href="/" className="hover:text-ink">
            iodriven.tech
          </Link>
          <Link href="/privacy" className="hover:text-ink">
            {t("auth.side.privacy")}
          </Link>
          <span>© 2026 IO Driven</span>
        </p>
      </main>
    </div>
  );
}
