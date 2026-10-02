import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, Building2, ChevronDown, Cpu, KeyRound, Lock, RefreshCw, Send, ShieldAlert, SlidersHorizontal, Users, Zap } from "lucide-react";
import { buttonClassName } from "@/components/ui/Button";
import { ControlLoop } from "@/components/marketing/ControlLoop";
import { Deployment } from "@/components/marketing/Deployment";
import { EnterButton } from "@/components/marketing/EnterButton";
import { NetworkCanvas } from "@/components/marketing/NetworkCanvas";
import { ProductTour } from "@/components/marketing/ProductTour";
import { cn } from "@/lib/cn";

/* iodriven.tech landing (DESIGN.md §10, demo G): nav · hero over the network
 * · product tour · how it works · safety · onboarding (ControlLoop) ·
 * security and operations · deployment (Talk to us) · FAQ · close · footer.
 * There is no public demo workspace, so G's "Open the demo" becomes
 * "Sign in" / "Talk to us". */

const NAV: [string, string][] = [
  ["tour", "Product"],
  ["how", "How it works"],
  ["safety", "Safety"],
  ["onboarding", "Onboarding"],
  ["security", "Security"],
  ["deployment", "Deployment"],
  ["faq", "FAQ"],
];

function Section({ id, eyebrow, title, note, alt, children }: { id: string; eyebrow: string; title: string; note?: ReactNode; alt?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={cn("scroll-mt-16 py-16 md:py-24", alt && "border-y border-border bg-surface")}>
      <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6">
        <p className="mb-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">{eyebrow}</p>
        <h2 className="max-w-[24ch] text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink md:text-[38px]">{title}</h2>
        {note && <p className="mt-4 max-w-[68ch] text-[16px] leading-relaxed text-ink-muted">{note}</p>}
        <div className="mt-10">{children}</div>
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

const Arrow = () => <span aria-hidden className="hidden h-px w-6 shrink-0 bg-border md:block" />;

const FAQ: [string, ReactNode][] = [
  [
    "What happens when a device is offline?",
    "No platform can reach a device that isn't connected. Commands go to a retained desired-state topic, so the device converges to the latest intended state the moment it reconnects. Commands carry a TTL, so it never acts on an old instruction.",
  ],
  ["Which hardware works?", "Anything that speaks MQTT over TLS. The generated sketch targets ESP32-class boards, and boards without Wi-Fi settings expose a BLE service for provisioning from a phone."],
  [
    "How fast is it really?",
    "The requirement is under two seconds from breach to command. On a single host, typical breach-to-command time is well under 500 ms because rules run in memory before anything is written.",
  ],
  ["Can I connect OPC UA or Modbus equipment?", "Yes, through an edge connector running on your network. It translates to the device contract and looks like any other device to the platform."],
  ["Who can see what?", "Every workspace is isolated by Postgres row-level security. Inside a workspace, Viewers see everything and change nothing; dashboards are personal to each member."],
  [
    "What does a device need to speak?",
    <>
      <pre className="mb-3 overflow-x-auto rounded-lg border border-border bg-canvas p-3 font-mono text-[12.5px] leading-[1.7] text-ink">
        {`{tenant}/{device}/{metric}          telemetry      device → platform
{tenant}/{device}/cmd/{actuator}    command        QoS 1
{tenant}/{device}/state/{actuator}  desired state  retained
{tenant}/{device}/ack/{actuator}    ack            device → platform
{tenant}/{device}/config            profile        retained
{tenant}/{device}/status            health         last will

mosquitto_pub -t "northfield/bay1-climate/temperature" -m '{"value": 31.5}'`}
      </pre>
      MQTT over TLS with a per-device credential, stored hashed. The same six topics work on Cloud, Dedicated cloud and On-premise, and the generated sketch already
      speaks them.
    </>,
  ],
  [
    "How long is history kept?",
    "Raw readings are kept for your workspace's retention period, enforced in the database. After about a week they're compressed, and dashboards read 1-minute and 1-hour rollups. On-premise, you set the retention yourself.",
  ],
];

export default function LandingPage() {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center gap-6 px-4 md:px-6">
          <Link href="/" className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.01em] text-ink">
            <span aria-hidden className="h-[18px] w-[18px] rounded-[5px] bg-[linear-gradient(135deg,var(--color-accent),var(--color-chart))]" />
            iodriven<span className="font-normal text-ink-muted">.tech</span>
          </Link>
          <nav aria-label="Page sections" className="hidden flex-1 items-center gap-1 lg:flex">
            {NAV.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="rounded-md px-2.5 py-1.5 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink">
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <EnterButton variant="ghost" />
            <a href="#deployment" className={buttonClassName()}>
              Talk to us
            </a>
          </div>
        </div>
      </header>

      <main>
        <section id="top" className="relative overflow-hidden">
          <NetworkCanvas className="absolute inset-0 h-full w-full opacity-60" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,var(--color-canvas)_35%,transparent_80%)]" />
          <div className="relative mx-auto w-full max-w-[1120px] px-4 pb-14 pt-20 md:px-6 md:pt-28">
            <p className="mkt-fade mkt-fade-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">IoT platform · MQTT · rules · control</p>
            <h1 className="mkt-fade mkt-fade-2 mt-3 max-w-[16ch] text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink md:text-[60px]">
              Your sensors report. <span className="text-ink-muted">Your rules decide.</span> <span className="text-ink-muted">Your actuators move.</span>
            </h1>
            <p className="mkt-fade mkt-fade-3 mt-6 max-w-[58ch] text-[17px] leading-relaxed text-ink-muted">
              iodriven takes telemetry over MQTT, checks every rule <b className="text-ink">in memory, the moment a reading arrives</b>, and sends the response: an
              actuator command, an email, a notification or a webhook. Well inside two seconds.
            </p>
            <div className="mkt-fade mkt-fade-3 mt-8 flex flex-wrap gap-3">
              <a href="#deployment" className={cn(buttonClassName(), "h-11 px-5 text-[15px]")}>
                Talk to us
              </a>
              <a href="#how" className={cn(buttonClassName({ variant: "secondary" }), "h-11 px-5 text-[15px]")}>
                See how it works
              </a>
            </div>
            <dl className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Breach → command", "< 2 s", "the requirement every design choice protects"],
                ["Typical on one host", "< 500 ms", "no disk, queue or batch on the hot path"],
                ["Devices per host", "500–1,000", "one Linux VPS, Docker Compose"],
                ["Sign-up to live data", "10 min", "template, sketch, flash"],
              ].map(([dt, dd, note]) => (
                <div key={dt} className="rounded-2xl border border-border bg-surface/90 p-4 shadow-card backdrop-blur">
                  <dt className="text-[13px] text-ink-muted">{dt}</dt>
                  <dd className="mt-1 text-[28px] font-semibold tracking-[-0.02em] text-ink tabular-nums">{dd}</dd>
                  <span className="text-[12.5px] text-ink-muted">{note}</span>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <Section id="tour" eyebrow="Product" title="Everything an operator needs, nothing they have to babysit.">
          <ProductTour />
        </Section>

        <Section
          id="how"
          alt
          eyebrow="How it works"
          title="The decision never waits on a disk."
          note="Every reading forks at ingestion. One copy is checked against your rules in memory and can move an actuator. The other is buffered and batch-written for history. A batch flush is never between a reading and a decision."
        >
          <div role="img" aria-label="Readings go from devices to EMQX to ingestion, then fork into a hot path and a storage path" className="flex flex-col gap-4">
            <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
              <FlowNode icon={<Cpu size={16} />} name="Devices" sub="ESP32 · MQTT/TLS" />
              <Arrow />
              <FlowNode icon={<Send size={16} />} name="EMQX" sub="per-device ACLs" />
              <Arrow />
              <FlowNode icon={<Activity size={16} />} name="Ingestion" sub="validates every payload" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-accent/40 bg-accent-muted/50 p-4">
                <p className="mb-3 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-accent">Hot path · milliseconds</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <FlowNode icon={<SlidersHorizontal size={16} />} name="Rule evaluator" sub="in memory, no DB read" />
                  <FlowNode icon={<Zap size={16} />} name="Command service" sub="QoS 1 · TTL" />
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-canvas p-4">
                <p className="mb-3 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Storage path · throughput</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <FlowNode icon={<RefreshCw size={16} />} name="Redis stream" sub="buffer, batched writer" />
                  <FlowNode icon={<Building2 size={16} />} name="TimescaleDB" sub="rollups · retention" />
                </div>
              </div>
            </div>
          </div>
          <ol className="mt-10 grid gap-4 md:grid-cols-4">
            {[
              ["Acquire", "Devices publish readings over MQTT/TLS. Malformed messages are dropped and logged, never stop the stream."],
              ["Decide", "Rules evaluate on the reading itself, across devices, with ALL / ANY logic. No polling, no cron."],
              ["Act", "A firing rule switches actuators, emails the alert list, posts a notification or calls a webhook."],
              ["Confirm", "The device acknowledges the command. Failures land in Failed deliveries with the reason, and can be retried."],
            ].map(([t, d], i) => (
              <li key={t} className="flex flex-col gap-1.5">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-[13px] font-semibold text-on-accent">{i + 1}</span>
                <b className="text-ink">{t}</b>
                <span className="text-[14.5px] leading-relaxed text-ink-muted">{d}</span>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          id="safety"
          eyebrow="Safety"
          title="Real relays are on the other end of the command."
          note={
            <>
              Hold time, hysteresis and cooldown are part of every rule, not an advanced tab you forget to open, and the editor checks hardware rules before they
              save. <b className="text-ink">A noisy sensor won&apos;t chatter your relay to death.</b>
            </>
          }
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Card title="Hold time">The condition must stay true this long before the rule fires, so brief spikes are ignored.</Card>
            <Card title="Hysteresis">The reading must come back past a margin before the rule re-arms. 30 °C fires; 28 °C re-arms.</Card>
            <Card title="Cooldown">A hard floor on the time between two firings of the same rule, whatever the data does.</Card>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              [<ShieldAlert key="a" size={18} />, "Stale data is unknown, never false.", "A silent sensor neither fires nor clears a rule."],
              [<Lock key="b" size={18} />, "Latch until reset", "for interlocks that must stay tripped until a person looks."],
              [<RefreshCw key="c" size={18} />, "Commands carry a TTL.", "A device back from a long outage takes the latest desired state, not a stale order."],
            ].map(([icon, b, rest]) => (
              <p key={b as string} className="flex gap-3 text-[14.5px] text-ink">
                <span className="mt-0.5 shrink-0 text-accent">{icon}</span>
                <span>
                  <b>{b}</b> {rest}
                </span>
              </p>
            ))}
          </div>
        </Section>

        <Section id="onboarding" alt eyebrow="Onboarding" title="From sign-up to live data in ten minutes.">
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <ol className="flex flex-col gap-5">
              {[
                ["Create a workspace", "The tenant is provisioned in the same step. Invite your team as Admins or Viewers."],
                ["Define a device template", "The metrics it reports, the actuators it drives, units and ranges."],
                ["Copy the generated sketch", "Topics, TLS and the device's credential are already filled in. Wi-Fi can be provisioned over BLE."],
                ["Flash it", "The connect page turns green as the board reports in, and any armed rule is already watching."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-semibold text-on-accent">{i + 1}</span>
                  <span className="flex flex-col gap-0.5">
                    <b className="text-ink">{t}</b>
                    <span className="text-[14.5px] leading-relaxed text-ink-muted">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="flex flex-col gap-3">
              <ControlLoop />
              <p className="text-[13.5px] text-ink-muted">
                What happens after step 4: a reading crosses the threshold, the rule holds, fires, and the actuator acknowledges. All in memory, before anything is
                written to disk.
              </p>
            </div>
          </div>
        </Section>

        <Section id="security" eyebrow="Security and operations" title="Runs on one box. Isolated by the database.">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card icon={<Building2 size={20} />} title="Tenant isolation in Postgres">
              Every table carries a tenant id with a row-level-security policy, so a forgotten WHERE clause is a bug, not a data breach.
            </Card>
            <Card icon={<KeyRound size={20} />} title="Credentials never in plaintext">
              Per-device tokens and API keys are hashed with argon2id and shown once. Each device can only touch its own topics.
            </Card>
            <Card icon={<Users size={20} />} title="Roles that match the work">
              Owner, Admin and Viewer. Only an owner grants ownership, and API keys can never be Owner.
            </Card>
            <Card icon={<RefreshCw size={20} />} title="Backups you've restored">
              Daily backups and a restore runbook that has actually been run. Recovery in minutes, no cluster to keep alive at 3 am.
            </Card>
            <Card icon={<SlidersHorizontal size={20} />} title="Edge connectors">
              OPC UA, Modbus or a vendor cloud? A small connector on your network speaks MQTT to the platform. Industrial servers stay off the internet.
            </Card>
            <Card icon={<Zap size={20} />} title="Anomaly detection next">
              It arrives as one more rule evaluator on the same in-memory path, able to drive actuators, not another service to run.
            </Card>
          </div>
        </Section>

        <Section
          id="deployment"
          alt
          eyebrow="Deployment"
          title="Run it where your data needs to live."
          note="Same product, same firmware, same device contract. Choose who operates it and where the data sits. Devices flashed for one option work on the others without a reflash."
        >
          <Deployment />
        </Section>

        <Section id="faq" eyebrow="FAQ" title="Questions operators ask first.">
          <div className="flex max-w-[820px] flex-col divide-y divide-border rounded-2xl border border-border bg-surface">
            {FAQ.map(([q, a], i) => (
              <details key={q} open={i === 0} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium text-ink">
                  {q}
                  <ChevronDown aria-hidden size={16} className="shrink-0 text-ink-muted transition-transform group-open:rotate-180" />
                </summary>
                <div className="mt-2 text-[14.5px] leading-relaxed text-ink-muted">{a}</div>
              </details>
            ))}
          </div>
        </Section>

        <section className="border-t border-border py-20">
          <div className="mx-auto flex w-full max-w-[1120px] flex-col items-start gap-4 px-4 md:px-6">
            <h2 className="text-[30px] font-semibold tracking-[-0.025em] text-ink md:text-[38px]">Ready when your devices are.</h2>
            <p className="max-w-[60ch] text-[16px] text-ink-muted">Tell us about your sites and how you want to run it. Already have a workspace? Sign in.</p>
            <div className="flex flex-wrap gap-3">
              <a href="#deployment" className={cn(buttonClassName(), "h-11 px-5 text-[15px]")}>
                Talk to us
              </a>
              <EnterButton variant="secondary" className="h-11 px-5 text-[15px]" />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-[13px] text-ink-muted md:px-6">
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-3.5 w-3.5 rounded-[4px] bg-[linear-gradient(135deg,var(--color-accent),var(--color-chart))]" />
            iodriven.tech
          </span>
          <span>MQTT/TLS · FastAPI · TimescaleDB · EMQX · Docker Compose</span>
          <span>© 2026 iodriven</span>
        </div>
      </footer>
    </>
  );
}
