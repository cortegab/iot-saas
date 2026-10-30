"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Tag } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Select } from "@/components/ui/Select";
import { Table } from "@/components/ui/Table";
import { OptionGroup, plural, StepNav } from "@/components/devices/connect/parts";
import type { ConnectFlow, InstallPath } from "@/components/devices/connect/useConnectFlow";
import { BOARDS, CHIPS, pinChoices, type SketchBoard } from "@/lib/firmware-sketch";
import { wireId } from "@/lib/wire-id";

/** Step 2: wiring (or board and pins, for the sketch), Wi-Fi and broker. */
export function OptionsStep({ flow }: { flow: ConnectFlow }) {
  const { install, phone, ssid, hostProblem, blocked } = flow;
  return (
    <>
      <h2 className="text-section font-semibold text-ink">Options</h2>
      {install ? <InstallLead flow={flow} install={install} /> : <SketchLead flow={flow} />}
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          {install ? (
            <WiringCard flow={flow} install={install} />
          ) : (
            <OptionGroup
              label="Board"
              value={flow.board}
              onChange={(v) => flow.changeBoard(v as SketchBoard)}
              options={CHIPS.map((c) => [c, BOARDS[c].label, BOARDS[c].blurb] as const)}
            />
          )}
          <WifiOptions flow={flow} />
        </div>
        <div className="flex flex-col gap-4">
          <BrokerOptions flow={flow} />
          {install ? <InstallSummary flow={flow} install={install} /> : <SketchPinsAndSummary flow={flow} />}
        </div>
      </div>
      <StepNav state="Choose the board, Wi-Fi and broker, then continue" onBack={() => flow.setStep(1)} onNext={() => flow.setStep(3)} nextDisabled={blocked || (!phone && !ssid) || hostProblem != null} />
    </>
  );
}

function InstallLead({ flow, install }: { flow: ConnectFlow; install: InstallPath }) {
  return (
    <p className="text-sm text-ink-muted">
      The board gets firmware <b className="text-ink">{install.firmware.version}</b>, set up from{" "}
      {flow.device.hardware ? "this device's own wiring" : <>the <b className="text-ink">{flow.template.name}</b> wiring</>} and these choices. Nothing to
      edit or compile: you install it on the next step.
    </p>
  );
}

function SketchLead({ flow }: { flow: ConnectFlow }) {
  const { device, template, wiring, deviceWiringHref, templateWiringHref } = flow;
  // Why this device gets the sketch: wiring for a board the release doesn't
  // know, no release published, or no wiring at all.
  return (
    <>
      <p className="text-sm text-ink-muted">
        The sketch is built from the <b className="text-ink">{template.name}</b> template and these choices. You get it on the next step.
      </p>
      <Callout>
        {wiring && flow.firmwarePublished ? (
          <>
            This device is wired for a board the published firmware doesn&apos;t know (<code className="font-mono">{wiring.board}</code>). Pick
            another board in{" "}
            <Link href={device.hardware ? deviceWiringHref : templateWiringHref} className="text-accent hover:underline">
              {device.hardware ? "this device's wiring" : "the template's wiring"}
            </Link>
            , or use the sketch.
          </>
        ) : wiring ? (
          "No firmware release is published yet, so this device gets the sketch to upload."
        ) : (
          <>
            To install from this page with no code, set up the wiring on the{" "}
            <Link href={templateWiringHref} className="text-accent hover:underline">
              {template.name} template
            </Link>{" "}
            for every device of it, or{" "}
            <Link href={deviceWiringHref} className="text-accent hover:underline">
              for this device alone
            </Link>
            .
          </>
        )}
      </Callout>
    </>
  );
}

function WiringCard({ flow, install }: { flow: ConnectFlow; install: InstallPath }) {
  const { device, template, deviceWiringHref, templateWiringHref } = flow;
  const { model, guide, unlinkedPins } = install;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-meta font-medium text-ink">
          Wiring {device.hardware && <Tag size="sm">This device&apos;s own</Tag>}
        </span>
        <span className="flex gap-3 text-xs">
          <Link href={deviceWiringHref} className="text-accent hover:underline">
            {device.hardware ? "Change this device's wiring" : "Wire this device differently"}
          </Link>
          {!device.hardware && (
            <Link href={templateWiringHref} className="text-accent hover:underline">
              Edit the template&apos;s ({plural(template.device_count, "device")})
            </Link>
          )}
        </span>
      </div>
      <p className="text-sm text-ink">
        {model.label}
        {model.description && <span className="text-ink-muted"> · {model.description}</span>}
      </p>
      {guide.pins.length > 0 ? (
        <Table
          columns={[
            { header: "Pin", render: (r) => <span className="font-mono">{r.name}</span>, className: "w-36" },
            { header: "Connects to", render: (r) => r.to },
          ]}
          rows={guide.pins}
          rowKey={(r) => `${r.pin}-${r.role}-${r.to}`}
        />
      ) : (
        <p className="text-sm text-ink-muted">Nothing is wired yet, so the board will only report that it&apos;s online.</p>
      )}
      {unlinkedPins.length > 0 && (
        <Callout tone="warning">
          GPIO {unlinkedPins.join(", ")} {unlinkedPins.length === 1 ? "isn't" : "aren't"} linked to a metric, so{" "}
          {unlinkedPins.length === 1 ? "it won't" : "they won't"} publish anything. Pick the metric in{" "}
          <Link href={device.hardware ? deviceWiringHref : templateWiringHref} className="text-accent hover:underline">
            the wiring
          </Link>
          .
        </Callout>
      )}
    </div>
  );
}

function WifiOptions({ flow }: { flow: ConnectFlow }) {
  return (
    <>
      <OptionGroup
        label="Wi-Fi"
        value={flow.phone ? "ble" : "sketch"}
        onChange={(v) => flow.setWifiMode(v as "ble" | "sketch")}
        options={
          flow.phoneSetup
            ? [
                [
                  "ble",
                  "Set up from a phone",
                  "ESP BLE Provisioning app, Security 1 (PoP): the app proves it holds this device's password, then you pick the network. Nothing about your Wi-Fi in the firmware.",
                ],
                flow.install
                  ? ["sketch", "Type it in", "Quick for a bench test. Readable from the board's flash."]
                  : ["sketch", "Type it into the sketch", "Quick for a bench test. Readable from the binary."],
              ]
            : // No Bluetooth on this board: the only way in (DESIGN.md §8).
              [["sketch", "Type it in", "This board has no Bluetooth, so its Wi-Fi goes in with the config. To change networks, run Install again."]]
        }
      />
      {!flow.phone && (
        <div className="grid grid-cols-2 gap-2">
          {!flow.phoneSetup && (
            <p className="col-span-2 text-xs text-ink-muted">Saved on the board with its config. Anyone holding the board can read it.</p>
          )}
          <Field label="Network (2.4 GHz)">
            <Input value={flow.ssid} autoComplete="off" onChange={(e) => flow.setSsid(e.target.value)} />
          </Field>
          <Field label="Password">
            <PasswordInput aria-label="Wi-Fi password" value={flow.wifiPassword} autoComplete="off" onChange={(e) => flow.setWifiPassword(e.target.value)} />
          </Field>
        </div>
      )}
    </>
  );
}

function BrokerOptions({ flow }: { flow: ConnectFlow }) {
  return (
    <>
      <Field label="Broker host" error={flow.hostProblem ?? undefined} hint="Where the board connects: this server's address, as the board's network sees it.">
        <Input mono value={flow.host} autoComplete="off" spellCheck={false} onChange={(e) => flow.setHost(e.target.value)} />
      </Field>
      <OptionGroup
        label="Connection"
        value={flow.tls ? "tls" : "plain"}
        onChange={(v) => flow.setTls(v === "tls")}
        options={[
          ["tls", "TLS on 8883", "Production. Certificate validated."],
          ["plain", "Plain 1883", "Local broker only."],
        ]}
      />
      {!flow.tls && (
        <p className="flex gap-1.5 text-xs text-status-pending">
          <AlertTriangle aria-hidden size={13} className="mt-0.5 shrink-0" />
          Without TLS the credential crosses the network in the clear. Use it only against a local development broker.
        </p>
      )}
    </>
  );
}

function InstallSummary({ flow, install }: { flow: ConnectFlow; install: InstallPath }) {
  const { phone, security, name, ssid, tls, host, checkedMetrics, boolActuators } = flow;
  return (
    <div className="rounded-lg bg-canvas px-3.5 py-3 text-meta">
      <p className="mb-1 font-medium text-ink">The board gets</p>
      <ul className="list-disc pl-5 text-ink-muted">
        <li>
          Firmware {install.firmware.version} for the {install.model.label}
        </li>
        <li>
          {phone
            ? `Wi-Fi from a phone (Espressif provisioning, Security ${security} – PoP), advertised as "${name}". Any Wi-Fi it had saved is erased.`
            : `Wi-Fi "${ssid || "…"}", typed in.`}
        </li>
        {phone && <li>To set a new Wi-Fi later: hold {install.model.reset.label} for 5 seconds.</li>}
        <li>
          MQTT over {tls ? "TLS on 8883" : "plain 1883"} to {host || "…"}, {checkedMetrics.length} metric{checkedMetrics.length === 1 ? "" : "s"} and {boolActuators.length} actuator
          {boolActuators.length === 1 ? "" : "s"} wired
        </li>
      </ul>
    </div>
  );
}

function SketchPinsAndSummary({ flow }: { flow: ConnectFlow }) {
  const { metrics, actuators, boolActuators, pins, clashes, board, boardInfo, phone, security, name, tls } = flow;
  return (
    <>
      {Object.keys(pins).length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-meta font-medium text-ink">Pins</legend>
          {[...metrics.filter((m) => m.data_type === "bool").map((m) => [`m:${wireId(m)}`, m.name, "input"] as const), ...boolActuators.map((a) => [`a:${wireId(a)}`, a.name, "output"] as const)].map(([k, label, dir]) => (
            <div key={k} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-2">
              <span className="min-w-0 text-sm text-ink">
                {label} <small className="font-mono text-ink-muted">{k.slice(2)} · {dir}</small>
              </span>
              <Select
                aria-label={`GPIO for ${label}`}
                aria-invalid={clashes[k] ? true : undefined}
                value={pins[k]}
                onChange={(e) => flow.setPinOverrides((p) => ({ ...p, [k]: Number(e.target.value) }))}
              >
                {pinChoices(board).map((p) => (
                  <option key={p} value={p}>
                    GPIO {p}
                  </option>
                ))}
              </Select>
              {clashes[k] && <p className="col-span-2 text-xs text-status-error">{clashes[k]}</p>}
            </div>
          ))}
        </fieldset>
      )}
      <div className="rounded-lg bg-canvas px-3.5 py-3 text-meta">
        <p className="mb-1 font-medium text-ink">The sketch includes</p>
        <ul className="list-disc pl-5 text-ink-muted">
          <li>
            {boardInfo.label}: Arduino board &quot;{boardInfo.arduinoBoard}&quot;{boardInfo.ideSettings.length ? `, ${boardInfo.ideSettings.join(", ")}` : ""}
          </li>
          <li>
            {phone
              ? `Wi-Fi from a phone (Espressif provisioning, Security ${security} – PoP), advertised as "${name}". Needs the Huge APP partition.`
              : "Wi-Fi in the firmware. Fits the default partition."}
          </li>
          {phone && <li>To set a new Wi-Fi later: hold {boardInfo.resetButton} for 5 seconds.</li>}
          <li>
            MQTT over {tls ? "TLS on 8883" : "plain 1883"}, {metrics.length} metric{metrics.length === 1 ? "" : "s"}, {actuators.length} actuator
            {actuators.length === 1 ? "" : "s"}
          </li>
        </ul>
      </div>
    </>
  );
}
