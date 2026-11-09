import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/BrandMark";

export const metadata = {
  title: "Privacy · IO Driven",
  description: "What IO Driven and its mobile app collect, why, where it's kept and how to have it deleted.",
};

const UPDATED = "7 November 2026";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-section font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

/** The privacy policy (DESIGN.md §10): a plain document page on the app's
 * tokens, linked from the landing footer, the sign-in page and the Play
 * Store listing. */
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="night-bg border-b border-[rgba(148,163,184,0.14)]">
        <div className="mx-auto flex h-[62px] w-full max-w-[760px] items-center px-4 md:px-6">
          <Link href="/" className="flex items-center gap-2.5 text-[18px] font-bold tracking-[-0.01em] text-white">
            <BrandMark />
            IO Driven
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-4 py-10 text-sm leading-relaxed text-ink md:px-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-title font-semibold tracking-[-0.02em]">Privacy</h1>
          <p className="text-meta text-ink-muted">Last updated {UPDATED}</p>
        </div>

        <p className="max-w-[70ch]">
          IO Driven (iodriven.tech) runs an IoT platform: devices send readings, rules act on them, and people watch and control them on the web and in
          the IO Driven app. This page says what we collect, why, where it&apos;s kept and how to have it removed.
        </p>

        <Section title="What we keep">
          <ul className="flex max-w-[70ch] list-disc flex-col gap-1.5 pl-5">
            <li>
              <b>Your account:</b> name, email address and a hashed password (never the password itself), and the workspaces you belong to with your role
              in each.
            </li>
            <li>
              <b>Your workspace&apos;s data:</b> devices and their settings, the readings they send, rules, commands sent to actuators, dashboards and
              alerts. Device and API credentials are stored hashed.
            </li>
            <li>
              <b>Device health:</b> what devices report about themselves: online or offline, Wi-Fi signal, battery, uptime and firmware version.
            </li>
            <li>
              <b>Your phone, if you turn on alerts:</b> a push token from Firebase Cloud Messaging, per workspace, so we can send this phone notifications.
            </li>
          </ul>
          <p className="max-w-[70ch]">We don&apos;t use advertising, analytics trackers or sell any data.</p>
        </Section>

        <Section title="The mobile app's permissions">
          <ul className="flex max-w-[70ch] list-disc flex-col gap-1.5 pl-5">
            <li>
              <b>Camera:</b> only to read a device&apos;s label or Wi-Fi setup QR. Frames are read on the phone; no picture is stored or sent.
            </li>
            <li>
              <b>Nearby devices (Bluetooth):</b> only to set up a board&apos;s Wi-Fi. The network name and password go from the phone to the board over an
              encrypted Bluetooth session and are kept on the board only, never sent to our servers. On Android 11 and older, Android requires location
              access for Bluetooth scanning; the app doesn&apos;t use your location.
            </li>
            <li>
              <b>Notifications:</b> only if you turn on alerts. A notification carries device and rule names, never readings. It&apos;s delivered through
              Google&apos;s Firebase Cloud Messaging. You can turn alerts off in the app (More → Notifications) or in the phone&apos;s settings.
            </li>
          </ul>
        </Section>

        <Section title="Where it's kept and for how long">
          <p className="max-w-[70ch]">
            Data is stored on our server, with daily backups. Connections use TLS, and each workspace&apos;s data is kept apart by the database
            itself. Readings are kept for your workspace&apos;s retention period, then deleted automatically; the rest is kept while your account or
            workspace exists. Dedicated and on-premise installations keep data where you run them.
          </p>
        </Section>

        <Section title="Who else handles it">
          <ul className="flex max-w-[70ch] list-disc flex-col gap-1.5 pl-5">
            <li>
              <b>Google Firebase Cloud Messaging</b>, to deliver push notifications to phones that turned them on.
            </li>
            <li>
              <b>Our email provider</b>, to send the alert emails your rules ask for, and account emails such as invitations and password resets.
            </li>
          </ul>
          <p className="max-w-[70ch]">We share data with no one else, except where the law requires it.</p>
        </Section>

        <Section title="Your choices">
          <p className="max-w-[70ch]">
            You can change your name and password on the web, leave a workspace, and turn notifications off at any time. To have your
            account or a workspace&apos;s data deleted, or to get a copy of it, use <b>Talk to us</b> on{" "}
            <Link href="/#deployment" className="text-accent hover:underline">
              iodriven.tech
            </Link>
            ; we answer within 30 days.
          </p>
        </Section>

        <Section title="Children">
          <p className="max-w-[70ch]">IO Driven is a tool for businesses and isn&apos;t meant for children under 16.</p>
        </Section>

        <Section title="Changes">
          <p className="max-w-[70ch]">
            When this policy changes, we update this page and its date. A change to what we collect is announced in the app before it applies.
          </p>
        </Section>
      </main>
    </div>
  );
}
