"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Health = { status: string } | null;

export default function Home() {
  const [health, setHealth] = useState<Health>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then((data: { status: string }) => setHealth(data))
      .catch((e: unknown) => setError(String(e)));
  }, []);

  const ok = health?.status === "ok";

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "4rem 1.5rem" }}>
      <h1 style={{ fontSize: "1.75rem", marginBottom: "0.25rem" }}>iot-saas</h1>
      <p style={{ color: "#8b949e", marginTop: 0 }}>Development stack — Phase 0 skeleton</p>

      <section
        style={{
          marginTop: "2rem",
          padding: "1.25rem 1.5rem",
          borderRadius: 12,
          background: "#11161d",
          border: "1px solid #232b34",
        }}
      >
        <h2 style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#8b949e", margin: "0 0 0.75rem" }}>
          Backend API
        </h2>
        {error ? (
          <p style={{ color: "#f85149", margin: 0 }}>
            ✗ Cannot reach API at {API_URL} — {error}
          </p>
        ) : health ? (
          <p style={{ color: ok ? "#3fb950" : "#d29922", margin: 0 }}>
            {ok ? "✓" : "•"} {API_URL} → {health.status}
          </p>
        ) : (
          <p style={{ color: "#8b949e", margin: 0 }}>Checking {API_URL}…</p>
        )}
      </section>
    </main>
  );
}
