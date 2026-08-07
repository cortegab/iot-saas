import type { ReactNode } from "react";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

export const metadata = {
  title: "iot-saas",
  description: "IoT telemetry, rules, and actuator control",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="m-0 min-h-screen">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
