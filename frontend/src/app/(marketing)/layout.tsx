import type { ReactNode } from "react";
import "./marketing.css";

/* The landing page renders in the app's Control Room theme — fonts come from
 * the root layout (`--ff-*` on <html>), colours from `globals.css` tokens.
 * `marketing.css` only carries this page's marketing-scale layout, scoped to
 * `.mkt` so it can't leak into the authenticated app. */

export const metadata = {
  title: "iodriven — sensors in, actuators out, under two seconds",
  description:
    "A self-hostable IoT platform: ingest sensor telemetry over MQTT, run threshold and window rules in memory, and drive actuators, send notifications, or call webhooks — with flap protection built into every rule.",
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <div className="mkt">{children}</div>;
}
