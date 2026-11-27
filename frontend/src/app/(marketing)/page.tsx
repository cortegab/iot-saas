import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Code2, House, Wrench } from "lucide-react";
import { EnterButton } from "@/components/marketing/EnterButton";
import { RevealOnScroll } from "@/components/marketing/RevealOnScroll";
import { RuleLoopCard } from "@/components/marketing/RuleLoopCard";
import { TalkToUsButton } from "@/components/marketing/TalkToUsButton";
import { nightButtonClassName } from "@/components/marketing/night";
import { cn } from "@/lib/cn";
import { BrandMark } from "@/components/brand/BrandMark";
import { marketingCopy, type MarketingCopy } from "@/lib/marketing-copy";
import { serverLocale } from "@/lib/i18n-server";

/* iodriven.tech landing (DESIGN.md §10, landing demo 1 "The story"): a night
 * nav and hero with the live rule card · how it works (each step with a
 * technical note) · safety · use cases · who it's for · for integrators ·
 * getting started · deployment · FAQ · a night close and footer. "Talk to
 * us" opens the contact form wherever it appears. */

const EYEBROW = "mb-3 font-mono text-[12px] uppercase tracking-[0.14em]";
const INNER = "mx-auto w-full max-w-[1180px] px-4 md:px-6";

function Section({ id, eyebrow, title, note, alt, children }: { id: string; eyebrow: string; title: string; note?: ReactNode; alt?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={cn("scroll-mt-16 py-16 md:py-[88px]", alt && "border-y border-border bg-surface")}>
      <div className={INNER}>
        <p className={cn(EYEBROW, "text-accent")}>{eyebrow}</p>
        <h2 className="max-w-[22ch] text-balance text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink md:text-[40px]">{title}</h2>
        {note && <p className="mt-3.5 max-w-[64ch] text-[16px] leading-[1.65] text-ink-muted">{note}</p>}
        <div className="mt-9">{children}</div>
      </div>
    </section>
  );
}

/** A card that fades up when scrolled to (RevealOnScroll). */
function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div data-reveal className={cn("flex flex-col gap-1.5 rounded-2xl border border-border bg-surface p-5 shadow-card", className)}>
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-base font-semibold text-ink">{children}</h3>;
}

function CardBody({ children }: { children: ReactNode }) {
  return <p className="text-[14.5px] leading-relaxed text-ink-muted">{children}</p>;
}

function StepNumber({ n }: { n: number }) {
  return <span className="mb-3 grid h-7 w-7 place-items-center rounded-full bg-accent-muted font-mono text-[13px] font-semibold text-accent-strong">{n}</span>;
}

/** Safety: one noisy reading against the on and re-arm lines, with the
 * single "fan on" span the brakes allow. */
function SafetyChart({ s }: { s: MarketingCopy["safety"] }) {
  return (
    <svg viewBox="0 0 520 150" role="img" aria-label={s.chart} className="h-auto w-full">
      <line x1="0" x2="520" y1="44" y2="44" stroke="var(--color-status-offline)" strokeDasharray="4 4" />
      <text x="514" y="38" textAnchor="end" fontSize="11" fill="var(--color-ink-muted)" className="font-mono">
        {s.onLine}
      </text>
      <line x1="0" x2="520" y1="84" y2="84" stroke="var(--color-status-online)" strokeDasharray="4 4" />
      <text x="514" y="100" textAnchor="end" fontSize="11" fill="var(--color-ink-muted)" className="font-mono">
        {s.resetLine}
      </text>
      <rect x="196" y="122" width="210" height="14" rx="4" fill="color-mix(in srgb, var(--color-accent) 22%, transparent)" />
      <text x="301" y="132.5" textAnchor="middle" fontSize="10.5" fill="var(--color-accent-strong)" className="font-mono">
        {s.fanOn}
      </text>
      <path
        d="M0 110 L30 104 L55 98 L80 90 L100 70 L112 46 L122 58 L134 40 L146 50 L158 36 L176 30 L196 26 L220 30 L250 24 L280 34 L300 40 L318 54 L334 46 L350 64 L370 76 L390 80 L406 90 L430 96 L470 102 L520 106"
        fill="none"
        stroke="var(--color-chart)"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const WHO_ICONS = [<House key="a" size={20} />, <Wrench key="b" size={20} />, <Code2 key="c" size={20} />];

export default async function LandingPage() {
  const c = marketingCopy(await serverLocale());
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[rgba(148,163,184,0.14)] bg-[rgba(9,13,27,0.82)] backdrop-blur-md">
        <div className={cn(INNER, "flex h-[62px] items-center gap-5")}>
          <Link href="/" className="flex shrink-0 items-center gap-2.5 whitespace-nowrap text-[18px] font-bold tracking-[-0.01em] text-white">
            <BrandMark />
            IO Driven
          </Link>
          <nav aria-label={c.nav.label} className="ml-3 hidden items-center gap-0.5 lg:flex">
            {c.nav.items.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-lg px-2.5 py-2 text-sm text-[#b8c4d6] hover:bg-[rgba(148,163,184,0.12)] hover:text-white">
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <EnterButton />
            {/* Below sm the header can't fit both; the hero's Talk to us is right below. */}
            <TalkToUsButton className={cn(nightButtonClassName(), "max-sm:hidden")}>{c.nav.talk}</TalkToUsButton>
          </div>
        </div>
      </header>

      <main>
        <section id="top" className="night-bg relative overflow-hidden pb-10 pt-[72px] text-night-ink">
          <div className={INNER}>
            <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
              <div>
                <p className={cn(EYEBROW, "mkt-fade mkt-fade-1 text-night-sky")}>{c.hero.eyebrow}</p>
                <h1 className="mkt-fade mkt-fade-2 text-balance text-[38px] font-semibold leading-[1.03] tracking-[-0.04em] text-white md:text-[62px]">
                  {c.hero.line1}
                  <span className="block text-[#93a4bd]">{c.hero.line2}</span>
                  <span className="block text-[#93a4bd]">{c.hero.line3}</span>
                </h1>
                <p className="mkt-fade mkt-fade-3 mt-5 max-w-[52ch] text-[17px] leading-[1.6] text-night-muted">
                  {c.hero.leadBefore}
                  <b className="font-semibold text-white">{c.hero.leadBold}</b>
                  {c.hero.leadAfter}
                </p>
                <div className="mkt-fade mkt-fade-3 mt-7 flex flex-wrap gap-2.5">
                  <TalkToUsButton className={nightButtonClassName({ size: "lg" })}>
                    {c.nav.talk} <ChevronRight aria-hidden size={16} />
                  </TalkToUsButton>
                  <a href="#how" className={nightButtonClassName({ kind: "ghost", size: "lg" })}>
                    {c.hero.howLink}
                  </a>
                </div>
              </div>
              <RuleLoopCard withLog className="mkt-fade mkt-fade-4" />
            </div>
            <dl className="mt-14 grid grid-cols-2 gap-4 border-t border-night-line pt-[22px] lg:grid-cols-4">
              {c.hero.stats.map(([dt, dd, note]) => (
                <div key={dt}>
                  <dt className="text-[12.5px] text-night-dim">{dt}</dt>
                  <dd className="mb-0.5 mt-1 font-mono text-[22px] tracking-[-0.02em] text-white tabular-nums md:text-[28px]">{dd}</dd>
                  <dd className="m-0 text-[12.5px] text-night-faint">{note}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <Section id="how" eyebrow={c.how.eyebrow} title={c.how.title} note={c.how.note}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {c.how.steps.map(([title, body, tech], i) => (
              <Card key={title}>
                <StepNumber n={i + 1} />
                <CardTitle>{title}</CardTitle>
                <CardBody>{body}</CardBody>
                <details className="group mt-2 border-t border-dashed border-border pt-2.5">
                  <summary className="cursor-pointer list-none font-mono text-[12.5px] font-medium text-accent [&::-webkit-details-marker]:hidden">
                    <span aria-hidden className="group-open:hidden">{"+ "}</span>
                    <span aria-hidden className="hidden group-open:inline">{"– "}</span>
                    {c.how.techLabel}
                  </summary>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">{tech}</p>
                </details>
              </Card>
            ))}
          </div>
        </Section>

        <Section id="safety" alt eyebrow={c.safety.eyebrow} title={c.safety.title} note={c.safety.note}>
          <div className="grid gap-4 md:grid-cols-3">
            {c.safety.cards.map(([title, body]) => (
              <Card key={title}>
                <CardTitle>{title}</CardTitle>
                <CardBody>{body}</CardBody>
              </Card>
            ))}
          </div>
          <Card className="mt-6 grid items-center gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <SafetyChart s={c.safety} />
            <div className="flex flex-col gap-2.5 text-[14.5px] text-ink">
              <p>
                <b className="font-semibold">{c.safety.withoutBold}</b> {c.safety.without}
              </p>
              <p>
                <b className="font-semibold">{c.safety.withBold}</b> {c.safety.with}
              </p>
              <p className="flex gap-2 text-[13.5px] text-status-unknown">
                <span aria-hidden className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-current" />
                {c.safety.unknown}
              </p>
            </div>
          </Card>
        </Section>

        <Section id="uses" eyebrow={c.uses.eyebrow} title={c.uses.title} note={c.uses.note}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {c.uses.items.map(([tag, title, body, rule]) => (
              <Card key={title}>
                <span className="mb-1 self-start rounded-md bg-[color-mix(in_srgb,var(--color-chart)_10%,transparent)] px-2 py-1 font-mono text-[12px] text-chart">{tag}</span>
                <CardTitle>{title}</CardTitle>
                <CardBody>{body}</CardBody>
                <p className="mt-auto border-t border-border-soft pt-2.5 text-[13.5px] text-ink">{rule}</p>
              </Card>
            ))}
          </div>
        </Section>

        <Section id="who" alt eyebrow={c.who.eyebrow} title={c.who.title} note={c.who.note}>
          <div className="grid gap-4 md:grid-cols-3">
            {c.who.items.map(([title, body, points], i) => (
              <Card key={title} className={cn("gap-2.5", i === 1 && "border-accent/45 bg-[linear-gradient(180deg,var(--color-accent-muted),var(--color-surface)_60%)]")}>
                <span className="text-accent">{WHO_ICONS[i]}</span>
                <CardTitle>{title}</CardTitle>
                <CardBody>{body}</CardBody>
                <ul className="mt-1 list-disc pl-[18px] text-[14.5px] text-ink-muted">
                  {points.map((p) => (
                    <li key={p} className="my-[3px]">
                      {p}
                    </li>
                  ))}
                </ul>
                {i === 1 && (
                  <a href="#integrators" className="mt-auto pt-1.5 font-medium text-accent hover:underline">
                    {c.who.integratorsLink} →
                  </a>
                )}
              </Card>
            ))}
          </div>
        </Section>

        <Section id="integrators" eyebrow={c.integrators.eyebrow} title={c.integrators.title} note={c.integrators.note}>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {c.integrators.cards.map(([title, body]) => (
              <Card key={title}>
                <CardTitle>{title}</CardTitle>
                <CardBody>{body}</CardBody>
              </Card>
            ))}
          </div>
        </Section>

        <Section id="start" alt eyebrow={c.start.eyebrow} title={c.start.title} note={c.start.note}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {c.start.steps.map(([title, body], i) => (
              <Card key={title}>
                <StepNumber n={i + 1} />
                <CardTitle>{title}</CardTitle>
                <CardBody>{body}</CardBody>
              </Card>
            ))}
          </div>
        </Section>

        <Section id="deployment" eyebrow={c.deployment.eyebrow} title={c.deployment.title} note={c.deployment.note}>
          <div className="grid gap-4 md:grid-cols-3">
            {c.deployment.options.map(([name, big, sub, points]) => (
              <Card key={name}>
                <CardTitle>{name}</CardTitle>
                <p className="mt-0.5 text-[22px] font-semibold tracking-[-0.02em] text-ink">{big}</p>
                <p className="text-[13px] text-ink-muted">{sub}</p>
                <ul className="mt-3 list-disc pl-[18px] text-[14px] text-ink-muted">
                  {points.map((p) => (
                    <li key={p} className="my-[3px]">
                      {p}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </Section>

        {/* The heading beside the questions. */}
        <section id="faq" className="scroll-mt-16 border-y border-border bg-surface py-16 md:py-[88px]">
          <div className={cn(INNER, "grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]")}>
            <div>
              <p className={cn(EYEBROW, "text-accent")}>{c.faq.eyebrow}</p>
              <h2 className="max-w-[22ch] text-balance text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink md:text-[40px]">{c.faq.title}</h2>
            </div>
            <div className="flex flex-col border-t border-border">
              {c.faq.items.map(([q, text], i) => (
                <details key={q} open={i === 0} className="group border-b border-border">
                  <summary className="flex cursor-pointer list-none justify-between gap-3 py-[18px] text-[16px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                    {q}
                    <ChevronDown aria-hidden size={16} className="mt-[3px] shrink-0 text-ink-muted transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="max-w-[64ch] pb-[18px] leading-[1.65] text-ink-muted">{text}</div>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="night-close py-16 text-center text-white md:py-[88px]">
          <div className={INNER}>
            <h2 className="mx-auto max-w-[22ch] text-balance text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] md:text-[40px]">{c.close.title}</h2>
            <p className="mt-3 text-[16px] text-night-muted">{c.close.body}</p>
            <div className="mt-7 flex flex-wrap justify-center gap-2.5">
              <TalkToUsButton className={nightButtonClassName({ size: "lg" })}>
                {c.nav.talk} <ChevronRight aria-hidden size={16} />
              </TalkToUsButton>
              <EnterButton size="lg" />
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-night-deep text-[13px] text-night-faint">
        <div className={cn(INNER, "flex flex-wrap items-center justify-between gap-4 py-7")}>
          <span className="flex items-center gap-2 font-semibold text-night-ink">
            <BrandMark size={18} />
            iodriven.tech
          </span>
          <span>{c.footer.tagline}</span>
          <span className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-night-ink hover:underline">
              {c.footer.privacy}
            </Link>
            <span>© 2026 IO Driven</span>
          </span>
        </div>
      </footer>
      <RevealOnScroll />
    </>
  );
}
