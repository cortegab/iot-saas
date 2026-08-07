"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];

// A generic placeholder metric — the user can rename the topic's last segment
// to whatever they're actually measuring, as the sketch's own comment says.
const PLACEHOLDER_METRIC = "temperature";

function buildSketch(created: DeviceCreateResponse): string {
  const host = typeof window !== "undefined" ? window.location.hostname : "YOUR_SERVER_HOST";
  const topic = `${created.tenant_slug}/${created.device.slug}/${PLACEHOLDER_METRIC}`;

  return `#include <WiFi.h>
#include <PubSubClient.h>

// Wi-Fi credentials — fill these in.
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// MQTT broker — defaults to this dashboard's own host, since the platform and
// broker share one server. Change MQTT_HOST if your broker lives elsewhere.
// Port 1883 is plaintext, matching this dev deployment; switch to 8883 with
// WiFiClientSecure once TLS is configured in production.
const char* MQTT_HOST = "${host}";
const int MQTT_PORT = 1883;
const char* MQTT_USERNAME = "${created.credential.username}";
const char* MQTT_PASSWORD = "${created.credential.password}";

// Rename "${PLACEHOLDER_METRIC}" to whatever you're actually measuring — just
// keep it consistent with the metric name you use in rules and charts later.
const char* TELEMETRY_TOPIC = "${topic}";

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

void connectWifi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
}

void connectMqtt() {
  while (!mqttClient.connected()) {
    mqttClient.connect(MQTT_USERNAME, MQTT_USERNAME, MQTT_PASSWORD);
    if (!mqttClient.connected()) {
      delay(2000);
    }
  }
}

void setup() {
  connectWifi();
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
}

void loop() {
  if (!mqttClient.connected()) {
    connectMqtt();
  }
  mqttClient.loop();

  // Placeholder reading — replace this with your real sensor code.
  float value = 20.0 + random(0, 100) / 10.0;
  char payload[64];
  snprintf(payload, sizeof(payload), "{\\"value\\": %.1f}", value);
  mqttClient.publish(TELEMETRY_TOPIC, payload);

  delay(5000);
}
`;
}

// The hero element (UX_UI_Description.md §1: "the code block is the hero
// element, not an afterthought") — a ready-to-paste sketch with credentials
// already filled in.
function FirmwareSketch({ created }: { created: DeviceCreateResponse }) {
  const [copied, setCopied] = useState(false);
  const sketch = buildSketch(created);

  return (
    <div className="rounded-xl border border-accent/40 bg-surface p-4">
      <p className="text-sm font-medium text-ink">Flash this onto your ESP32</p>
      <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-surface-raised p-3 text-xs text-ink">
        <code>{sketch}</code>
      </pre>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(sketch).then(() => setCopied(true));
        }}
        className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
      >
        {copied ? "Copied" : "Copy sketch"}
      </button>
    </div>
  );
}

// The payoff moment (UX_UI_Description.md §1: "a live 'waiting for first
// message' state that visibly reacts the instant data arrives"). Polls from
// the moment the device exists — not gated on any copy action, since flashing
// might happen through a path other than this page's own copy buttons.
function WaitingForFirstData({ deviceId }: { deviceId: string }) {
  const { data } = useApiSWR<TelemetryLatestResponse[]>(`/devices/${deviceId}/latest`, {
    refreshInterval: 2000,
  });
  const reading = data?.[0];

  if (reading) {
    return (
      <div className="rounded-xl border border-status-online/40 bg-status-online/10 p-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-status-online" aria-hidden />
          <p className="text-sm font-medium text-status-online">Live data received</p>
        </div>
        <p className="mt-2 text-sm text-ink">
          {reading.metric}: <span className="font-mono">{reading.value}</span>
        </p>
        <Link href={`/devices/${deviceId}`} className="mt-3 inline-block text-sm text-accent">
          Continue to device →
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-status-pending" aria-hidden />
        <p className="text-sm text-ink">Waiting for first message…</p>
      </div>
      {/* Inline troubleshooting, not a link to docs (UX_UI_Description.md §1). */}
      <p className="mt-2 text-xs text-ink-muted">
        No data yet? Check the board is on the same Wi-Fi, and that the credentials above were
        copied exactly.
      </p>
    </div>
  );
}

export default function NewDevicePage() {
  const api = useApi();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<DeviceCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.post<DeviceCreateResponse>("/devices", { name });
      setCreated(result);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // The credential is shown exactly once and can never be fetched again — make
  // that consequence obvious before the user navigates away
  // (UX_UI_Description.md §1).
  if (created) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <h1 className="text-lg font-semibold text-ink">{created.device.name} created</h1>

        <div className="rounded-xl border border-status-pending/40 bg-status-pending/10 p-4">
          <p className="text-sm font-medium text-ink">
            Copy this credential now — it will not be shown again.
          </p>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <div>
              <dt className="text-ink-muted">Username</dt>
              <dd className="font-mono text-ink">{created.credential.username}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Password</dt>
              <dd className="font-mono text-ink">{created.credential.password}</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(
                  `username: ${created.credential.username}\npassword: ${created.credential.password}`,
                )
                .then(() => setCopied(true));
            }}
            className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
          >
            {copied ? "Copied" : "Copy credential"}
          </button>
        </div>

        <Link
          href={`/devices/${created.device.id}`}
          aria-disabled={!copied}
          onClick={(e) => {
            if (!copied) e.preventDefault();
          }}
          className={`text-center text-sm ${copied ? "text-accent" : "pointer-events-none text-ink-muted"}`}
        >
          {copied ? "Continue to device →" : "Copy the credential to continue"}
        </Link>

        <FirmwareSketch created={created} />
        <WaitingForFirstData deviceId={created.device.id} />
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="flex max-w-sm flex-col gap-4 rounded-xl border border-border bg-surface p-6"
    >
      <h1 className="text-lg font-semibold text-ink">Add a device</h1>

      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Name
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Greenhouse sensor 1"
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-ink"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-status-error">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {submitting ? "Creating…" : "Create device"}
      </button>
    </form>
  );
}
