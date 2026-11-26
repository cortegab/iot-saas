import type { ReactNode } from "react";
import type { Metadata } from "next";
import { serverLocale } from "@/lib/i18n-server";
import "./marketing.css";

/* The landing page uses the app's design tokens (docs/design/DESIGN.md §10);
 * fonts come from the root layout, colours from `globals.css`. `.mkt` scopes
 * the entrance motion (marketing.css). */

const META = {
  en: {
    title: "IO Driven — sensors in, decisions in memory, actuators out",
    description:
      "An IoT platform for MQTT devices: every rule is checked in memory the moment a reading arrives, and drives actuators, email, notifications or webhooks well inside two seconds. Cloud, dedicated or on-premise.",
  },
  es: {
    title: "IO Driven — sensores que reportan, decisiones en memoria, actuadores que responden",
    description:
      "Una plataforma IoT para dispositivos MQTT: cada regla se evalúa en memoria en cuanto llega una lectura y mueve actuadores, envía correos, notificaciones o webhooks muy por debajo de dos segundos. En la nube, dedicada o en sitio.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  return META[await serverLocale()];
}

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <div className="mkt">{children}</div>;
}
