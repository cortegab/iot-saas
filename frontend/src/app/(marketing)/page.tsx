import Link from "next/link";
import { ControlLoop } from "@/components/marketing/ControlLoop";
import { EnterButton } from "@/components/marketing/EnterButton";

/* iodriven.tech landing page. Replaces the old `/` redirect gateway: a
 * logged-out visitor now gets this page and reaches the app through the CTA;
 * a logged-in visitor gets it too, with the CTA pointed at the console. */

export default function LandingPage() {
  return (
    <>
      <header className="mkt-bar">
        <Link href="/" className="mkt-wordmark">
          <span className="dot" aria-hidden="true" />
          iodriven<span className="tld">.tech</span>
        </Link>
        <EnterButton variant="ghost" />
      </header>

      <main>
        <section className="mkt-hero">
          <div className="mkt-inner">
            <p className="mkt-eyebrow mkt-fade mkt-fade-1">platform</p>
            <h1 className="mkt-fade mkt-fade-2">
              <span className="line">Your sensors report.</span>
              <span className="line soft">Your rules decide.</span>
              <span className="line soft">Your actuators move.</span>
            </h1>
            <p className="mkt-lede mkt-fade mkt-fade-3">
              iodriven ingests sensor telemetry over MQTT, evaluates every threshold and rule{" "}
              <strong>in memory, the moment a message arrives</strong>, and drives the response — an
              actuator command, a notification, or a webhook — in under two seconds.
            </p>
            <div className="mkt-cta-row mkt-fade mkt-fade-3">
              <EnterButton />
              <a className="mkt-btn mkt-btn--ghost" href="#onboarding">
                See how onboarding works
              </a>
            </div>

            <ControlLoop />
          </div>
        </section>

        <section className="mkt-section mkt-reveal">
          <div className="mkt-inner">
            <p className="mkt-eyebrow">what it does</p>
            <h2>A rules engine wired straight to your hardware.</h2>
            <div className="mkt-cards">
              <div className="mkt-card">
                <h3>acquire</h3>
                <p>
                  ESP32-class devices publish readings over MQTT/TLS. Everything lands in TimescaleDB
                  and streams to the browser over WebSocket for live dashboards.
                </p>
              </div>
              <div className="mkt-card">
                <h3>decide</h3>
                <p>
                  A rule watches one metric &mdash; a threshold, or a rolling window &mdash; on the
                  reading itself, the instant it arrives. No polling, no cron.
                </p>
              </div>
              <div className="mkt-card">
                <h3>act</h3>
                <p>
                  A firing rule sends an actuator command, raises a notification, or calls a webhook.
                  One rule, one of three outcomes.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mkt-section mkt-reveal">
          <div className="mkt-inner">
            <p className="mkt-eyebrow">the other end</p>
            <h2>Real relays are on the other end of the command.</h2>
            <p className="mkt-note">
              Duration, hysteresis, and cooldown are part of <strong>every</strong> rule &mdash; not
              an advanced tab you forget to open. A rule holds its condition before it fires, waits
              for the reading to fall back past a margin before it re-arms, and rate-limits itself.{" "}
              <strong>A noisy sensor will never chatter your relay to death.</strong>
            </p>
            <div className="mkt-cards">
              <div className="mkt-card">
                <h3>for_duration</h3>
                <p>The condition must hold this long before the rule fires &mdash; brief spikes are ignored.</p>
              </div>
              <div className="mkt-card">
                <h3>hysteresis</h3>
                <p>The reading must fall back past a margin before the rule can fire again.</p>
              </div>
              <div className="mkt-card">
                <h3>cooldown</h3>
                <p>A hard floor on the time between two firings of the same rule.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mkt-section mkt-reveal">
          <div className="mkt-inner">
            <p className="mkt-eyebrow">hot-path</p>
            <h2>The decision never waits on a disk.</h2>
            <div className="mkt-fork">
              <div className="mkt-path hot">
                <h3>Hot path</h3>
                <p>
                  Rules run in the worker&rsquo;s memory with no database read. A breach goes
                  straight to the command service, out through EMQX, and onto the device.
                </p>
                <p className="chain">reading &rarr; evaluate &rarr; command &rarr; EMQX &rarr; actuator</p>
              </div>
              <div className="mkt-path">
                <h3>Storage path</h3>
                <p>
                  Telemetry is pushed to a Redis stream and drained by a writer that batches inserts
                  into TimescaleDB. Built for throughput, not latency.
                </p>
                <p className="chain">reading &rarr; Redis stream &rarr; batched writer &rarr; TimescaleDB</p>
              </div>
            </div>
            <p className="mkt-forknote">
              A batch flush is never between a reading and a decision. That&rsquo;s the rule that
              keeps the two-second budget honest.
            </p>
          </div>
        </section>

        <section className="mkt-section mkt-reveal" id="onboarding">
          <div className="mkt-inner">
            <p className="mkt-eyebrow">onboarding</p>
            <h2>From sign-up to live data in ten minutes.</h2>
            <ol className="mkt-steps">
              <li>
                <p>
                  <strong>Create a workspace.</strong> The tenant is provisioned in the same step
                  &mdash; there&rsquo;s no separate setup.
                </p>
              </li>
              <li>
                <p>
                  <strong>Define a device template.</strong> The metrics a device reports, the
                  actuators it drives, the units and ranges.
                </p>
              </li>
              <li>
                <p>
                  <strong>Copy the generated Arduino sketch.</strong> Topics, TLS, and the
                  per-device credential are already filled in.
                </p>
              </li>
              <li>
                <p>
                  <strong>Flash it.</strong> Readings appear on the live chart, and any rule you
                  armed is already watching.
                </p>
              </li>
            </ol>
            <p className="mkt-note">
              No SDK to vendor, no sales call. A device speaks four MQTT topics and it&rsquo;s done.
            </p>
          </div>
        </section>

        <section className="mkt-section mkt-reveal" id="contract">
          <div className="mkt-inner">
            <p className="mkt-eyebrow">device contract</p>
            <h2>The contract a device speaks is small and fixed.</h2>
            <div className="mkt-topics">
              <pre>
                <span className="seg">{"{tenant}/{device}/{metric}"}</span>
                {"            telemetry        "}
                <span className="desc">device → platform</span>
                {"\n"}
                <span className="seg">{"{tenant}/{device}/cmd/{actuator}"}</span>
                {"      command          "}
                <span className="desc">platform → device, QoS 1</span>
                {"\n"}
                <span className="seg">{"{tenant}/{device}/state/{actuator}"}</span>
                {"    desired state    "}
                <span className="desc">retained</span>
                {"\n"}
                <span className="seg">{"{tenant}/{device}/ack/{actuator}"}</span>
                {"      acknowledgement  "}
                <span className="desc">device → platform</span>
              </pre>
            </div>
            <p className="mkt-note">
              MQTT over TLS. Per-device tokens, stored hashed with argon2id &mdash; never in
              plaintext. One firmware build works against the multi-tenant platform or a
              single-tenant deployment, because the contract is the same on both.
            </p>
          </div>
        </section>

        <section className="mkt-section mkt-reveal">
          <div className="mkt-inner">
            <p className="mkt-eyebrow">one host</p>
            <h2>Runs on one box. Isolated by the database.</h2>
            <p className="mkt-note">
              Sized for 500 to 1,000 devices on one Linux VPS &mdash; Docker Compose, daily backups
              with a restore runbook that has actually been run, no cluster to keep alive at 3am.
              Every table carries a tenant id with a Postgres row-level-security policy behind it, so
              a forgotten WHERE clause is a bug, not a data breach. Anomaly detection is next, and it
              arrives as another evaluator on the same in-memory hot path &mdash; not another service
              to operate.
            </p>
          </div>
        </section>

        <section className="mkt-close mkt-reveal">
          <div className="mkt-inner">
            <h2>Ready when your devices are.</h2>
            <div className="mkt-cta-row">
              <EnterButton />
            </div>
            <p className="sub">
              No workspace yet? <Link href="/register">Create one</Link> &mdash; it takes under a
              minute.
            </p>
          </div>
        </section>
      </main>

      <footer className="mkt-footer">
        <span>iodriven.tech — MQTT/TLS · FastAPI · TimescaleDB · Docker Compose</span>
        <span>© {new Date().getFullYear()} iodriven</span>
      </footer>
    </>
  );
}
