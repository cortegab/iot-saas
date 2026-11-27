import type { ReactNode } from "react";
import type { Metadata } from "next";
import { serverLocale } from "@/lib/i18n-server";
import "./marketing.css";

/* The landing page uses the app's design tokens (docs/design/DESIGN.md §10);
 * fonts come from the root layout, colours from `globals.css`. `.mkt` scopes
 * the entrance motion (marketing.css). */

const META = {
  en: {
    title: "IO Driven — your sensors report, your rules decide, your equipment responds",
    description:
      "Monitoring and automation for real equipment: IO Driven checks every sensor reading the moment it arrives and reacts in under two seconds, switching fans, pumps and valves or sending alerts. Cloud, dedicated or on-premise.",
  },
  es: {
    title: "IO Driven — sensores que reportan, reglas que deciden, equipos que responden",
    description:
      "Monitoreo y automatización para equipos reales: IO Driven revisa cada lectura en cuanto llega y reacciona en menos de dos segundos, accionando ventiladores, bombas y válvulas o enviando alertas. En la nube, dedicada o en sitio.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  return META[await serverLocale()];
}

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <div className="mkt">{children}</div>;
}
