"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, Download, KeyRound, Loader2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { SecretReveal } from "@/components/ui/SecretReveal";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/hooks/useAuth";
import { ApiRequestError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { forgetCredential, peekCredential } from "@/lib/credential-handoff";
import { DEVICE_STATUS, deviceStatusKey } from "@/lib/device-status";
import { buildSketch, defaultPins, pinClashes, PIN_CHOICES, type SketchCredential } from "@/lib/firmware-sketch";
import { useRealtimeEvents } from "@/lib/realtime-bus";
import { wireId } from "@/lib/wire-id";
import type { components } from "@/types/api";

type DeviceResponse = components["schemas"]["DeviceResponse"];
type DeviceCreateResponse = components["schemas"]["DeviceCreateResponse"];
type CatalogEntryResponse = components["schemas"]["CatalogEntryResponse"];

const STEPS = [
  ["Credential", "Shown once"],
  ["Firmware", "Board, Wi-Fi, pins"],
  ["Flash and Wi-Fi", "Upload and join"],
  ["Live check", "First data"],
] as const;

type CheckState = { ok?: boolean; busy?: boolean; detail?: string };
type CatalogActuator = components["schemas"]["CatalogActuator"];
interface CheckItem {
  k: string;
  label: string;
  sub: string;
  hint: string;
  /** Set for a command test row. */
  actuator?: CatalogActuator;
}

/** Connect a device (DESIGN.md §8, demo G): credential → firmware → flash →
 * live check. The live check listens on the app's realtime socket. */
export function ConnectFlow({ deviceId }: { deviceId: string }) {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { can } = usePermissions();
  const { memberships, currentTenantId } = useAuth();
  const tenantSlug = memberships.find((m) => m.tenant_id === currentTenantId)?.tenant_slug ?? "";
  const { data: device, error } = useApiSWR<DeviceResponse>(`/devices/${deviceId}`);
  const { data: template } = useApiSWR<CatalogEntryResponse>(device ? `/catalog/${device.catalog_entry_id}` : null);

  const [step, setStep] = useState(1);
  const [credential, setCredential] = useState<SketchCredential | null>(() => peekCredential(deviceId));
  const [stored, setStored] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [wifiMode, setWifiMode] = useState<"ble" | "sketch">("ble");
  const [ssid, setSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [tls, setTls] = useState(() => typeof window !== "undefined" && window.location.protocol === "https:");
  const [pinOverrides, setPinOverrides] = useState<Record<string, number>>({});
  const [live, setLive] = useState<Record<string, CheckState>>({});

  const metrics = useMemo(() => template?.metrics ?? [], [template]);
  const actuators = useMemo(() => template?.actuators ?? [], [template]);
  const pins = useMemo(() => ({ ...defaultPins(metrics, actuators), ...pinOverrides }), [metrics, actuators, pinOverrides]);
  const clashes = pinClashes(pins);
  const blocked = Object.keys(clashes).length > 0;
  const host = typeof window !== "undefined" ? window.location.hostname : "YOUR_SERVER_HOST";

  // The live check: status, first reading per metric, command acks.
  useRealtimeEvents((m) => {
    if (m.device_id !== deviceId) return;
    if (m.type === "device_health" && m.online) {
      setLive((l) => ({ ...l, status: { ok: true, detail: [m.rssi != null && `rssi ${m.rssi} dBm`, m.fw_version && `fw ${m.fw_version}`].filter(Boolean).join(" · ") || "online" } }));
    } else if (m.type === "telemetry" && m.metric) {
      setLive((l) => ({ ...l, status: l.status?.ok ? l.status : { ok: true, detail: "publishing" }, [`m:${m.metric}`]: { ok: true, detail: String(m.value) } }));
    } else if (m.type === "command_ack") {
      setLive((l) => {
        const waiting = Object.entries(l).find(([k, s]) => k.startsWith("a:") && s.busy);
        return waiting ? { ...l, [waiting[0]]: { ok: true, detail: "acknowledged" } } : l;
      });
    }
  });

  if (error) return <ErrorState title="Couldn't load this device" message={error instanceof ApiRequestError ? error.message : "The API didn't respond."} />;
  if (!device || !template) return <LoadingSkeleton rows={4} rowClassName="h-16" />;

  const st = DEVICE_STATUS[deviceStatusKey(device)];
  const neverConnected = device.connection_state === "never_connected";
  const sketchFor = (cred: SketchCredential | null) =>
    buildSketch({
      tenantSlug,
      deviceSlug: device.slug,
      deviceName: device.name,
      host,
      tls,
      metrics,
      actuators,
      credential: cred,
      wifi: wifiMode === "sketch" ? { ssid, password: wifiPassword } : undefined,
      pins,
    });

  async function rotate() {
    if (!neverConnected) {
      const ok = await confirm("The firmware running now disconnects until the new sketch is flashed.", {
        title: `Rotate the credential for ${device!.name}?`,
        confirmLabel: "Rotate credential",
      });
      if (!ok) return;
    }
    setRotating(true);
    try {
      const result = await api.post<DeviceCreateResponse>(`/devices/${deviceId}/rotate-credential`);
      setCredential(result.credential);
      setStored(false);
      toast({ title: "Credential ready", detail: "Store it, then continue to the firmware." });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't rotate the credential", detail: err instanceof ApiRequestError ? err.message : undefined });
    } finally {
      setRotating(false);
    }
  }

  async function copySketch() {
    try {
      await navigator.clipboard.writeText(sketchFor(credential));
      toast({ title: "Sketch copied", detail: "It includes the full credential." });
    } catch {
      toast({ tone: "error", title: "Couldn't reach the clipboard", detail: "Select the text and copy it with Ctrl+C." });
    }
  }

  function downloadSketch() {
    const blob = new Blob([sketchFor(credential)], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${device!.slug.replace(/[^a-zA-Z0-9_-]/g, "_")}.ino`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function sendTest(actuator: (typeof actuators)[number]) {
    const key = `a:${wireId(actuator)}`;
    setLive((l) => ({ ...l, [key]: { busy: true } }));
    try {
      await api.post(`/devices/${deviceId}/commands`, { actuator: wireId(actuator), value: actuator.on_value ?? true });
    } catch (err) {
      setLive((l) => ({ ...l, [key]: {} }));
      toast({ tone: "error", title: "Couldn't send the test", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  function leave(href: string) {
    forgetCredential(deviceId);
    router.push(href);
  }

  const boolActuators = actuators.filter((a) => (a.value_type ?? "bool") === "bool");
  const items: CheckItem[] = [
    { k: "status", label: "Reached the broker", sub: `${tenantSlug}/${device.slug}/status`, hint: "Check the board is powered and on a 2.4 GHz network, and that the whole credential was pasted." },
    ...metrics.map((m) => ({
      k: `m:${wireId(m)}`,
      label: `First reading: ${m.name}`,
      sub: `…/${wireId(m)}`,
      hint: m.data_type === "bool" ? `Check the wiring on GPIO ${pins[`m:${wireId(m)}`]}.` : "The sketch publishes nothing until your sensor code returns a number.",
    })),
    ...boolActuators.map((a) => ({
      k: `a:${wireId(a)}`,
      label: `Command test: ${a.name}`,
      sub: `…/cmd/${wireId(a)} → ack`,
      hint: `Nothing on GPIO ${pins[`a:${wireId(a)}`]}? Check the relay's supply and whether it's active-low.`,
      actuator: a,
    })),
  ];
  const allLive = items.every((it) => live[it.k]?.ok);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ href: "/devices", label: "Devices" }, { href: `/devices/${deviceId}`, label: device.name }, { label: "Connect" }]}
        title={
          <>
            Connect <span className="font-mono font-medium tracking-[-0.01em]">{device.name}</span>
          </>
        }
        status={<Badge tone={st.tone} shape={st.shape} label={st.label} />}
        description={`${template.name}. About ten minutes from here to live data.`}
        actions={
          <Button variant="ghost" onClick={() => leave(`/devices/${deviceId}`)}>
            I&apos;ll do this later
          </Button>
        }
      />

      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <ol aria-label="Steps" className="flex gap-1 overflow-x-auto md:flex-col">
          {STEPS.map(([title, sub], i) => {
            const n = i + 1;
            const state = (n === 4 && allLive) || n < step ? "done" : n === step ? "cur" : "todo";
            return (
              <li key={title}>
                <button
                  type="button"
                  disabled={n > 1 && !stored}
                  aria-current={n === step ? "step" : undefined}
                  onClick={() => setStep(n)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50",
                    n === step ? "bg-accent-muted" : "hover:bg-surface-raised",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
                      state === "done" ? "bg-status-online text-on-accent" : state === "cur" ? "bg-accent text-on-accent" : "bg-surface-raised text-ink-muted",
                    )}
                  >
                    {state === "done" ? <Check aria-hidden size={13} /> : n}
                  </span>
                  <span className="flex flex-col">
                    <strong className="whitespace-nowrap text-sm font-medium text-ink">{title}</strong>
                    <small className="whitespace-nowrap text-xs text-ink-muted max-md:hidden">{sub}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <section className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-card">
          {step === 1 && (
            <>
              <h2 className="text-lg font-semibold text-ink">Credential</h2>
              {!credential ? (
                <>
                  <Callout tone="warning">
                    <strong>Getting firmware {neverConnected ? "creates" : "rotates"} this device&apos;s credential.</strong> Credentials are stored
                    hashed, so the only way to put one in a sketch is to make a new one.{" "}
                    {neverConnected ? "This device has never connected, so nothing is interrupted." : `The firmware running on ${device.name} now disconnects until you flash the new sketch.`}
                  </Callout>
                  {can("devices.write") ? (
                    <div>
                      <Button variant={neverConnected ? "primary" : "danger"} disabled={rotating} onClick={() => void rotate()}>
                        <KeyRound aria-hidden size={15} />
                        {rotating ? "Working…" : neverConnected ? "Create credential" : "Rotate credential and continue"}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-ink-muted">Only admins can rotate credentials.</p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-ink-muted">
                    This is the MQTT login for <code className="font-mono">{device.name}</code>. It&apos;s already in the sketch on the next step, but
                    it&apos;s shown only once, so store it too. Broker: <code className="font-mono">{host}:{tls ? "8883 (TLS)" : "1883"}</code>.
                  </p>
                  <SecretReveal
                    fields={[
                      { label: "Username", value: credential.username },
                      { label: "Password", value: credential.password, secret: true },
                    ]}
                    copyValue={`username: ${credential.username}\npassword: ${credential.password}`}
                    copyLabel="Copy credential"
                    requireAcknowledge
                    dismissLabel="Continue"
                    onDismiss={() => {
                      setStored(true);
                      setStep(2);
                    }}
                  />
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-lg font-semibold text-ink">Firmware</h2>
              <p className="text-sm text-ink-muted">
                A ready-to-flash Arduino sketch for an ESP32 DevKit, built from the <b className="text-ink">{template.name}</b> template.
              </p>
              <div className="grid gap-5 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                <div className="flex flex-col gap-4">
                  <OptionGroup
                    label="Wi-Fi"
                    value={wifiMode}
                    onChange={(v) => setWifiMode(v as "ble" | "sketch")}
                    options={[
                      ["ble", "Set up from a phone", "Over BLE, encrypted. Nothing secret in the firmware."],
                      ["sketch", "Type it into the sketch", "Quick for a bench test. Readable from the binary."],
                    ]}
                  />
                  {wifiMode === "sketch" && (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Network (2.4 GHz)">
                        <Input value={ssid} autoComplete="off" onChange={(e) => setSsid(e.target.value)} />
                      </Field>
                      <Field label="Password">
                        <Input type="password" value={wifiPassword} autoComplete="off" onChange={(e) => setWifiPassword(e.target.value)} />
                      </Field>
                    </div>
                  )}
                  <OptionGroup
                    label="Connection"
                    value={tls ? "tls" : "plain"}
                    onChange={(v) => setTls(v === "tls")}
                    options={[
                      ["tls", "TLS on 8883", "Production. Certificate validated."],
                      ["plain", "Plain 1883", "Local broker only."],
                    ]}
                  />
                  {!tls && (
                    <p className="flex gap-1.5 text-[12.5px] text-status-pending">
                      <AlertTriangle aria-hidden size={13} className="mt-0.5 shrink-0" />
                      Without TLS the credential crosses the network in the clear. Use it only against a local development broker.
                    </p>
                  )}
                  {Object.keys(pins).length > 0 && (
                    <fieldset className="flex flex-col gap-2">
                      <legend className="mb-1 text-[13px] font-medium text-ink">Pins</legend>
                      {[...metrics.filter((m) => m.data_type === "bool").map((m) => [`m:${wireId(m)}`, m.name, "input"] as const), ...boolActuators.map((a) => [`a:${wireId(a)}`, a.name, "output"] as const)].map(([k, name, dir]) => (
                        <div key={k} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-2">
                          <span className="min-w-0 text-sm text-ink">
                            {name} <small className="font-mono text-ink-muted">{k.slice(2)} · {dir}</small>
                          </span>
                          <Select
                            aria-label={`GPIO for ${name}`}
                            aria-invalid={clashes[k] ? true : undefined}
                            value={pins[k]}
                            onChange={(e) => setPinOverrides((p) => ({ ...p, [k]: Number(e.target.value) }))}
                          >
                            {PIN_CHOICES.map((p) => (
                              <option key={p} value={p}>
                                GPIO {p}
                              </option>
                            ))}
                          </Select>
                          {clashes[k] && <p className="col-span-2 text-[12.5px] text-status-error">{clashes[k]}</p>}
                        </div>
                      ))}
                    </fieldset>
                  )}
                  <div className="text-[13px] text-ink-muted">
                    <p className="mb-1 font-medium text-ink">Install once</p>
                    <ul className="list-disc pl-5">
                      <li>ESP32 board package by Espressif (Boards Manager)</li>
                      <li>PubSubClient by Nick O&apos;Leary</li>
                      <li>ArduinoJson by Benoit Blanchon</li>
                    </ul>
                  </div>
                </div>
                <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border">
                  <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-raised px-3 py-2">
                    <span className="font-mono text-[12.5px] text-ink">{device.slug}.ino</span>
                    <span className="mr-auto text-xs text-ink-muted">{sketchFor(null).split("\n").length} lines</span>
                    <Button size="sm" variant="ghost" disabled={blocked} onClick={() => void copySketch()}>
                      <Copy aria-hidden size={14} />
                      Copy sketch
                    </Button>
                    <Button size="sm" variant="secondary" disabled={blocked} onClick={downloadSketch}>
                      <Download aria-hidden size={14} />
                      Download .ino
                    </Button>
                  </div>
                  <pre aria-label="Generated sketch" className="max-h-[520px] overflow-auto bg-canvas p-3 font-mono text-[12px] leading-[1.55] text-ink">
                    <code>{sketchFor(credential ? { username: credential.username, password: "••••••••" } : null)}</code>
                  </pre>
                  <p className="border-t border-border px-3 py-2 text-xs text-ink-muted">The preview masks the password. Copy and Download include it in full.</p>
                </div>
              </div>
              <StepNav onBack={() => setStep(1)} onNext={() => setStep(3)} nextDisabled={blocked} />
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-lg font-semibold text-ink">Flash and Wi-Fi</h2>
              <p className="text-sm text-ink-muted">
                Upload the sketch{wifiMode === "ble" ? ", then give the board your Wi-Fi from a phone" : ""}. Keep the Serial Monitor open: it tells you
                exactly where the board is.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-border p-4">
                  <h3 className="mb-2 text-sm font-semibold text-ink">Upload with Arduino IDE</h3>
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
                    <li>Plug the ESP32 in over USB.</li>
                    <li>
                      Tools → Board → <b>ESP32 Dev Module</b>.
                    </li>
                    <li>
                      Tools → Partition Scheme → <b>Huge APP (3MB No OTA/1MB SPIFFS)</b>. BLE and Wi-Fi don&apos;t fit the default.
                    </li>
                    <li>Paste the sketch, add your sensor code, and select Upload.</li>
                    <li>
                      Open the Serial Monitor at <b>115200 baud</b>.
                    </li>
                  </ol>
                  <p className="mt-2 text-xs text-ink-muted">
                    PlatformIO works too: <code className="font-mono">board = esp32dev</code>, same libraries.
                  </p>
                </div>
                {wifiMode === "ble" ? (
                  <div className="rounded-lg border border-border p-4">
                    <h3 className="mb-2 text-sm font-semibold text-ink">Wi-Fi from your phone</h3>
                    <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
                      <li>Open the provisioning app and choose Set up Wi-Fi.</li>
                      <li>
                        Pick <b className="font-mono">{device.name.slice(0, 20)}</b> from the nearby boards.
                      </li>
                      <li>Accept the pairing request. The link is encrypted before the password is sent.</li>
                      <li>Choose a 2.4 GHz network and enter its password.</li>
                    </ol>
                    <p className="mt-2 text-xs text-ink-muted">To provision again later, re-upload with &quot;Erase All Flash Before Sketch Upload&quot; on.</p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border p-4">
                    <h3 className="mb-2 text-sm font-semibold text-ink">Wi-Fi in the sketch</h3>
                    <p className="text-sm text-ink-muted">
                      The board joins <b className="text-ink">{ssid || "your network"}</b> on first boot and saves it. Change it by editing the sketch and
                      uploading again.
                    </p>
                  </div>
                )}
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="flex justify-between border-b border-border bg-surface-raised px-3 py-2 text-xs text-ink-muted">
                  <span>What the Serial Monitor shows when it works</span>
                  <span className="font-mono">115200</span>
                </div>
                <pre className="overflow-auto bg-canvas p-3 font-mono text-[12px] leading-[1.55] text-ink">
                  {[
                    `[BOOT] ${device.name}`,
                    ...(wifiMode === "ble" ? [`[PROV] no Wi-Fi stored, advertising over BLE as ${device.name.slice(0, 20)}`] : []),
                    "[WIFI] connected",
                    `[MQTT] connecting to ${host}:${tls ? "8883 (tls)" : "1883"}`,
                    "[MQTT] connected",
                    `[PUB ] ${tenantSlug}/${device.slug}/${metrics[0] ? wireId(metrics[0]) : "status"}`,
                  ].join("\n")}
                </pre>
              </div>
              <StepNav onBack={() => setStep(2)} onNext={() => setStep(4)} />
            </>
          )}

          {step === 4 && (
            <>
              <h2 className="text-lg font-semibold text-ink">Live check</h2>
              <p className="text-sm text-ink-muted">
                This page listens for {device.name}. Each line turns green on its own as the board connects, reports and answers.
              </p>
              {allLive && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-status-online/40 bg-status-online/10 p-4">
                  <Check aria-hidden size={20} className="text-status-online" />
                  <p className="mr-auto text-sm text-ink">
                    <strong>{device.name} is live.</strong> Readings are flowing{boolActuators.length ? " and every actuator answered" : ""}.
                  </p>
                  <Button onClick={() => leave(`/devices/${deviceId}`)}>
                    Open device <ChevronRight aria-hidden size={14} />
                  </Button>
                  <Button variant="secondary" onClick={() => leave("/devices/new")}>
                    Set up another device
                  </Button>
                </div>
              )}
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {items.map((it) => {
                  const s = live[it.k] ?? {};
                  const state = s.ok ? "ok" : s.busy ? "busy" : "wait";
                  return (
                    <li key={it.k} className="flex items-start gap-3 px-4 py-3">
                      <span
                        aria-hidden
                        className={cn(
                          "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full",
                          state === "ok" ? "bg-status-online text-on-accent" : "bg-surface-raised text-ink-muted",
                        )}
                      >
                        {state === "ok" ? <Check size={13} /> : state === "busy" ? <Loader2 size={13} className="animate-spin" /> : <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted" />}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <strong className="text-sm font-medium text-ink">
                          {it.label}
                          <span className="sr-only">{state === "ok" ? ": done" : ": waiting"}</span>
                        </strong>
                        <span className="font-mono text-xs text-ink-muted">{it.sub}</span>
                        {s.detail && <span className="text-xs text-status-online">{s.detail}</span>}
                        {state === "wait" && !it.actuator && (
                          <details className="text-xs text-ink-muted">
                            <summary className="cursor-pointer">Not showing up?</summary>
                            <p className="mt-1">{it.hint}</p>
                          </details>
                        )}
                      </div>
                      {it.actuator && (
                        <Button size="sm" variant="secondary" disabled={!live.status?.ok || s.ok || s.busy} onClick={() => {
                            if (it.actuator) void sendTest(it.actuator);
                          }}>
                          {s.ok ? "Acknowledged" : "Send test: on"}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <StepNav onBack={() => setStep(3)} />
            </>
          )}
        </section>
      </div>
      {dialog}
      <p className="sr-only" aria-live="polite">
        {allLive ? `${device.name} is live.` : ""}
      </p>
      {step === 4 && !allLive && (
        <p className="text-xs text-ink-muted">
          Stuck? The device page shows its <Link href={`/devices/${deviceId}`} className="text-accent hover:underline">status and readings</Link> too.
        </p>
      )}
    </>
  );
}

function OptionGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly (readonly [string, string, string])[];
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-[13px] font-medium text-ink">{label}</legend>
      {options.map(([v, title, sub]) => (
        <label
          key={v}
          className={cn(
            "grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 rounded-md border border-border bg-canvas px-3 py-2.5 hover:border-[color-mix(in_srgb,var(--color-accent)_50%,var(--color-border))]",
            value === v && "border-accent bg-accent-muted",
          )}
        >
          <input type="radio" name={label} value={v} checked={value === v} onChange={() => onChange(v)} className="mt-[3px] accent-[var(--color-accent)]" />
          <span className="flex flex-col">
            <strong className="text-sm font-medium text-ink">{title}</strong>
            <small className="text-xs text-ink-muted">{sub}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function StepNav({ onBack, onNext, nextDisabled }: { onBack?: () => void; onNext?: () => void; nextDisabled?: boolean }) {
  return (
    <div className="flex justify-between border-t border-border pt-4">
      {onBack ? (
        <Button variant="ghost" onClick={onBack}>
          <ChevronLeft aria-hidden size={14} />
          Back
        </Button>
      ) : (
        <span />
      )}
      {onNext && (
        <Button onClick={onNext} disabled={nextDisabled}>
          Continue <ChevronRight aria-hidden size={14} />
        </Button>
      )}
    </div>
  );
}
