import type { ReactNode } from "react";
import { Chivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

/* "Control Room" type system. Chivo carries headings and the wordmark; IBM Plex
 * Sans is the UI/body face; IBM Plex Mono renders every reading, ID, topic and
 * timestamp. Exposed as CSS vars on <html> and wired into Tailwind's font tokens
 * in globals.css. The marketing route group has its own fonts and is unaffected. */
const display = Chivo({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--ff-display",
  display: "swap",
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--ff-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--ff-mono",
  display: "swap",
});

/* Runs before first paint: apply the saved theme, or fall back to the OS
 * preference, by toggling `.light` on <html>. Inline and dependency-free —
 * next/script does not guarantee pre-paint execution. Paired with
 * suppressHydrationWarning on <html> (the class attribute is the only diff). */
const THEME_INIT = `(function(){try{var t=localStorage.getItem('iot-saas:theme');var l=t?t==='light':window.matchMedia('(prefers-color-scheme: light)').matches;document.documentElement.classList.toggle('light',l);}catch(e){}})();`;

export const metadata = {
  title: "iodriven",
  description: "IoT telemetry, rules, and actuator control",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="m-0 min-h-screen">
        {/* First child of <body>: runs synchronously during parse, before any
            body content paints, so the theme is right on first frame. React 19
            won't hoist an inline script, and a <script> child of <html> is
            invalid — <body> is the correct spot in the App Router. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
