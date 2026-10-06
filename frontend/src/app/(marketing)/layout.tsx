import type { ReactNode } from "react";
import "./marketing.css";

/* The landing page uses the app's design tokens (docs/design/DESIGN.md §10);
 * fonts come from the root layout, colours from `globals.css`. `.mkt` scopes
 * the entrance motion (marketing.css). */

export const metadata = {
  title: "iodriven — sensors in, decisions in memory, actuators out",
  description:
    "An IoT platform for MQTT devices: every rule is checked in memory the moment a reading arrives, and drives actuators, email, notifications or webhooks well inside two seconds. Cloud, dedicated or on-premise.",
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <div className="mkt">{children}</div>;
}
