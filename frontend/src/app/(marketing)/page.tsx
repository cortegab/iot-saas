import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, Building2, ChevronDown, ChevronRight, Cpu, KeyRound, Lock, RefreshCw, Send, ShieldAlert, SlidersHorizontal, Users, Zap } from "lucide-react";
import { ControlLoopLog } from "@/components/marketing/ControlLoopLog";
import { Deployment } from "@/components/marketing/Deployment";
import { EnterButton } from "@/components/marketing/EnterButton";
import { NetworkCanvas } from "@/components/marketing/NetworkCanvas";
import { OnboardingSection } from "@/components/marketing/OnboardingSection";
import { ProductTour } from "@/components/marketing/ProductTour";
import { Steps } from "@/components/marketing/Steps";
import { nightButtonClassName } from "@/components/marketing/night";
import { cn } from "@/lib/cn";
import { BrandMark } from "@/components/brand/BrandMark";
import { marketingCopy } from "@/lib/marketing-copy";
import { serverLocale } from "@/lib/i18n-server";

/* iodriven.tech landing (DESIGN.md §10, demo G): a night nav and hero over
 * the network · product tour · how it works (with the control-loop log) ·
 * safety · onboarding (the journey figure) · security and operations · deployment (Talk to us) ·
 * FAQ · a night close and footer. There is no public demo workspace, so G's
 * "Open the demo" becomes "Sign in" / "Talk to us". */

const EYEBROW = "mb-3 font-mono text-[12px] uppercase tracking-[0.14em]";


const INNER = "mx-auto w-full max-w-[1180px] px-4 md:px-6";

function Heading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <>
      <p className={cn(EYEBROW, "text-accent")}>{eyebrow}</p>
      <h2 className="max-w-[22ch] text-balance text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink md:text-[40px]">{title}</h2>
    </>
  );
}

function Section({ id, eyebrow, title, note, alt, children }: { id: string; eyebrow: string; title: string; note?: ReactNode; alt?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={cn("scroll-mt-16 py-16 md:py-[88px]", alt && "border-y border-border bg-surface")}>
      <div className={INNER}>
        <Heading eyebrow={eyebrow} title={title} />
        {note && <p className="mt-3.5 max-w-[68ch] text-[16px] leading-[1.65] text-ink-muted">{note}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

function Card({ icon, title, children }: { icon?: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-5 shadow-card">
      {icon && <span className="text-accent">{icon}</span>}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <div className="text-[14.5px] leading-relaxed text-ink-muted">{children}</div>
    </div>
  );
}

function FlowNode({ icon, name, sub }: { icon: ReactNode; name: string; sub: string }) {
  return (
    <div className="flex min-w-[140px] flex-1 flex-col gap-0.5 rounded-xl border border-border bg-surface px-3.5 py-3">
      <span className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="text-accent">{icon}</span>
        {name}
      </span>
      <span className="text-[12.5px] text-ink-muted">{sub}</span>
    </div>
  );
}

const SAFETY_ICONS = [<ShieldAlert key="a" size={18} />, <Lock key="b" size={18} />, <RefreshCw key="c" size={18} />];

const SECURITY_ICONS = [
  <Building2 key="a" size={20} />,
  <KeyRound key="b" size={20} />,
  <Users key="c" size={20} />,
  <RefreshCw key="d" size={20} />,
  <SlidersHorizontal key="e" size={20} />,
  <Zap key="f" size={20} />,
];

const Arrow = () => <span aria-hidden className="hidden h-px w-6 shrink-0 bg-border md:block" />;

/** The device-contract answer's topic table (FAQ): identical in every language. */
const TOPICS = `{tenant}/{device}/{metric}          telemetry      device → platform
{tenant}/{device}/cmd/{actuator}    command        QoS 1
{tenant}/{device}/state/{actuator}  desired state  retained
{tenant}/{device}/ack/{actuator}    ack            device → platform
{tenant}/{device}/config            profile        retained
{tenant}/{device}/status            health         last will

mosquitto_pub -t "northfield/bay1-climate/temperature" -m '{"value": 31.5}'`;

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
            <a href="#deployment" className={cn(nightButtonClassName(), "max-sm:hidden")}>
              {c.nav.talk}
            </a>
          </div>
        </div>
      </header>

      <main>
        <section id="top" className="night-bg relative isolate overflow-hidden pb-10 pt-[72px] text-night-ink">
          <NetworkCanvas className="absolute inset-0 -z-20 h-full w-full" />
          <div aria-hidden className="night-scrim-hero pointer-events-none absolute inset-0 -z-10" />
          <div className={INNER}>
            <div className="max-w-[760px]">
              <p className={cn(EYEBROW, "mkt-fade mkt-fade-1 text-night-sky")}>{c.hero.eyebrow}</p>
              <h1 className="mkt-fade mkt-fade-2 text-balance text-[38px] font-semibold leading-[1.02] tracking-[-0.04em] text-white md:text-[64px]">
                {c.hero.line1}
                <br />
                <span className="text-[#93a4bd]">{c.hero.line2}</span>
                <br />
                <span className="text-[#93a4bd]">{c.hero.line3}</span>
              </h1>
              <p className="mkt-fade mkt-fade-3 mt-5 max-w-[52ch] text-[17px] leading-[1.6] text-night-muted">
                {c.hero.leadBefore}
                <b className="font-semibold text-white">{c.hero.leadBold}</b>
                {c.hero.leadAfter}
              </p>
              <div className="mkt-fade mkt-fade-3 mt-7 flex flex-wrap gap-2.5">
                <a href="#deployment" className={nightButtonClassName({ size: "lg" })}>
                  {c.nav.talk} <ChevronRight aria-hidden size={16} />
                </a>
                <a href="#how" className={nightButtonClassName({ kind: "ghost", size: "lg" })}>
                  {c.hero.howLink}
                </a>
              </div>
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

        <Section id="tour" eyebrow={c.tour.eyebrow} title={c.tour.title}>
          <ProductTour />
        </Section>

        <Section
          id="how"
          alt
          eyebrow={c.how.eyebrow}
          title={c.how.title}
          note={c.how.note}
        >
          <div role="img" aria-label={c.how.diagram} className="flex flex-col gap-4">
            <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
              <FlowNode icon={<Cpu size={16} />} name={c.how.devices[0]} sub={c.how.devices[1]} />
              <Arrow />
              <FlowNode icon={<Send size={16} />} name={c.how.emqx[0]} sub={c.how.emqx[1]} />
              <Arrow />
              <FlowNode icon={<Activity size={16} />} name={c.how.ingestion[0]} sub={c.how.ingestion[1]} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-accent/40 bg-accent-muted/50 p-4">
                <p className="mb-3 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-accent">{c.how.hot}</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <FlowNode icon={<SlidersHorizontal size={16} />} name={c.how.evaluator[0]} sub={c.how.evaluator[1]} />
                  <FlowNode icon={<Zap size={16} />} name={c.how.command[0]} sub={c.how.command[1]} />
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-canvas p-4">
                <p className="mb-3 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{c.how.storage}</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <FlowNode icon={<RefreshCw size={16} />} name={c.how.redis[0]} sub={c.how.redis[1]} />
                  <FlowNode icon={<Building2 size={16} />} name={c.how.timescale[0]} sub={c.how.timescale[1]} />
                </div>
              </div>
            </div>
          </div>
          <div className="mt-8 grid items-center gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <ControlLoopLog />
            <p className="max-w-[52ch] text-[15px] leading-relaxed text-ink-muted">
              <b className="font-semibold text-ink">{c.how.lifeBold}</b> {c.how.life}
            </p>
          </div>
          <div className="mt-8">
            <Steps steps={c.how.steps} />
          </div>
        </Section>

        <Section
          id="safety"
          eyebrow={c.safety.eyebrow}
          title={c.safety.title}
          note={
            <>
              {c.safety.note} <b className="text-ink">{c.safety.noteBold}</b>
            </>
          }
        >
          <div className="grid gap-4 md:grid-cols-3">
            {c.safety.cards.map(([title, body]) => (
              <Card key={title} title={title}>
                {body}
              </Card>
            ))}
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {c.safety.facts.map(([b, rest], i) => (
              <p key={b} className="flex gap-3 text-[14.5px] text-ink">
                <span className="mt-0.5 shrink-0 text-accent">{SAFETY_ICONS[i]}</span>
                <span>
                  <b>{b}</b> {rest}
                </span>
              </p>
            ))}
          </div>
        </Section>

        {/* G .s-split: steps on the left, the journey figure beside them. */}
        <section id="onboarding" className="scroll-mt-16 border-y border-border bg-surface py-16 md:py-[88px]">
          <div className={INNER}>
            <OnboardingSection heading={<Heading eyebrow={c.onboarding.eyebrow} title={c.onboarding.title} />} />
          </div>
        </section>

        <Section id="security" eyebrow={c.security.eyebrow} title={c.security.title}>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {c.security.cards.map(([title, body], i) => (
              <Card key={title} icon={SECURITY_ICONS[i]} title={title}>
                {body}
              </Card>
            ))}
          </div>
        </Section>

        <Section
          id="deployment"
          alt
          eyebrow={c.deployment.eyebrow}
          title={c.deployment.title}
          note={c.deployment.note}
        >
          <Deployment />
        </Section>

        {/* G .s-faq: the heading beside the questions. */}
        <section id="faq" className="scroll-mt-16 py-16 md:py-[88px]">
          <div className={cn(INNER, "grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]")}>
            <div>
              <Heading eyebrow={c.faq.eyebrow} title={c.faq.title} />
            </div>
            <div className="flex flex-col border-t border-border">
              {c.faq.items.map(([q, text], i) => (
                <details key={q} open={i === 0} className="group border-b border-border">
                  <summary className="flex cursor-pointer list-none justify-between gap-3 py-[18px] text-[16px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                    {q}
                    <ChevronDown aria-hidden size={16} className="mt-[3px] shrink-0 text-ink-muted transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="max-w-[64ch] pb-[18px] leading-[1.65] text-ink-muted">
                    {/* The device-contract answer shows the topics first. */}
                    {i === 5 && (
                      <pre className="mb-3 overflow-x-auto rounded-lg border border-border bg-canvas p-3 font-mono text-[12.5px] leading-[1.7] text-ink">{TOPICS}</pre>
                    )}
                    {text}
                  </div>
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
              <a href="#deployment" className={nightButtonClassName({ size: "lg" })}>
                {c.nav.talk} <ChevronRight aria-hidden size={16} />
              </a>
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
          <span>MQTT/TLS · FastAPI · TimescaleDB · EMQX · Docker Compose</span>
          <span className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-night-ink hover:underline">
              {c.footer.privacy}
            </Link>
            <span>© 2026 IO Driven</span>
          </span>
        </div>
      </footer>
    </>
  );
}
