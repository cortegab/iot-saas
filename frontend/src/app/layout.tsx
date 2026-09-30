import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ToastProvider } from "@/components/ui/Toast";

/* Type system (docs/design/DESIGN.md §3): Geist for display, UI and readouts;
 * Geist Mono for keys, topics, payloads and times in chips. Exposed as CSS vars
 * on <html> and wired into Tailwind's font tokens in globals.css. */
const sans = Geist({
  subsets: ["latin"],
  variable: "--ff-sans",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--ff-mono",
  display: "swap",
});

/* Runs before first paint: apply the saved theme, or fall back to the OS
 * preference, by toggling `.dark` on <html> (light is the unclassed default).
 * Inline and dependency-free — next/script does not guarantee pre-paint
 * execution. Paired with suppressHydrationWarning on <html> (the class
 * attribute is the only diff). */
const THEME_INIT = `(function(){try{var t=localStorage.getItem('iot-saas:theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export const metadata = {
  title: "iodriven",
  description: "IoT telemetry, rules, and actuator control",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="m-0 min-h-screen">
        {/* First child of <body>: runs synchronously during parse, before any
            body content paints, so the theme is right on first frame. React 19
            won't hoist an inline script, and a <script> child of <html> is
            invalid — <body> is the correct spot in the App Router. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
