import type { ReactNode } from "react";
import Link from "next/link";
import { NetworkCanvas } from "@/components/marketing/NetworkCanvas";
import { cn } from "@/lib/cn";

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
        <h1 className="text-[25px] font-semibold tracking-[-0.025em] text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {children}
      {footer && <div className="border-t border-border pt-3 text-center text-[13.5px] text-ink-muted">{footer}</div>}
    </div>
  );
}

/* Example readings floating over the network (decorative; wide screens only). */
const CHIPS: { at: string; cmd?: boolean; body: ReactNode }[] = [
  { at: "left-[64%] top-[38%]", body: <><b>bay1-climate</b> temperature <b>25.3 °C</b></> },
  { at: "left-[50%] top-[74%]", cmd: true, body: <>pump1 → on · ack <b>212 ms</b></> },
  { at: "left-[9%] top-[60%]", body: <><b>pumphouse-main</b> tank <b>72 %</b></> },
];

/** The account pages' screen (DESIGN.md §10, demo G): a night brand panel —
 * the landing's network, a line about the product and its design figures —
 * beside the card. Below `lg` the panel becomes a band above the card. */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.15fr)_minmax(440px,1fr)]">
      <section
        aria-label="About iodriven"
        className="night-bg relative isolate flex min-h-[360px] flex-col justify-between gap-6 overflow-hidden px-5 py-6 text-night-ink lg:min-h-screen lg:px-11 lg:py-9"
      >
        <NetworkCanvas className="absolute inset-0 -z-20 h-full w-full" />
        <div aria-hidden className="night-scrim-panel pointer-events-none absolute inset-0 -z-10" />
        <Link href="/" className="relative z-[2] flex w-fit items-center gap-2.5 text-[18px] font-bold tracking-[-0.01em] text-white">
          <span aria-hidden className="h-[22px] w-[22px] rounded-[6px] bg-[linear-gradient(135deg,#818cf8,#22d3ee)] shadow-[0_0_22px_rgba(129,140,248,0.55)]" />
          iodriven
        </Link>
        <div className="relative z-[2] mb-auto mt-6 max-w-[31rem] lg:mt-[8vh]">
          <p className="mb-3.5 font-mono text-[12px] uppercase tracking-[0.14em] text-night-sky">Telemetry · Rules · Control</p>
          <h2 className="text-[27px] font-semibold leading-[1.06] tracking-[-0.035em] text-white lg:text-[clamp(30px,3.3vw,46px)]">
            From sensor to switch in under two seconds.
          </h2>
          <p className="mt-4 max-w-[44ch] text-[15.5px] leading-[1.6] text-night-muted">
            Every reading is checked against your rules the moment it arrives, before it&rsquo;s even stored. Actuators get their command while the data is still
            fresh.
          </p>
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] max-lg:hidden">
          {CHIPS.map((c, i) => (
            <span
              key={i}
              style={{ animationDelay: `${-2.3 * i}s` }}
              className={cn(
                "night-chip absolute inline-flex items-center gap-[7px] whitespace-nowrap rounded-full px-3 py-[7px] font-mono text-[12px] text-[#c3cedc] [&_b]:font-medium [&_b]:text-white",
                c.at,
                c.cmd && "night-chip--cmd",
              )}
            >
              <i
                className={cn(
                  "inline-block h-[7px] w-[7px] rounded-full",
                  c.cmd ? "bg-night-amber shadow-[0_0_8px_var(--color-night-amber)]" : "bg-night-ok shadow-[0_0_8px_var(--color-night-ok)]",
                )}
              />
              {c.body}
            </span>
          ))}
        </div>
        <dl className="relative z-[2] m-0 hidden max-w-[38rem] grid-cols-3 gap-4 border-t border-night-line pt-[18px] lg:grid">
          {[
            ["Breach → command", "< 2 s"],
            ["Typical on one host", "< 500 ms"],
            ["Devices per host", "500–1,000"],
          ].map(([dt, dd]) => (
            <div key={dt}>
              <dt className="text-[11.5px] text-night-dim">{dt}</dt>
              <dd className="mt-[3px] font-mono text-[21px] text-white tabular-nums">{dd}</dd>
            </div>
          ))}
        </dl>
      </section>
      <main className="auth-wash flex flex-col items-center justify-center gap-7 bg-canvas px-4 py-7 lg:px-6 lg:py-10">
        <div className="w-full max-w-[410px]">{children}</div>
        <p className="flex flex-wrap justify-center gap-4 text-[12.5px] text-ink-muted">
          <Link href="/" className="hover:text-ink">
            iodriven.tech
          </Link>
          <span>© 2026 iodriven</span>
        </p>
      </main>
    </div>
  );
}
