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
import { OptionGroup, StepNav } from "@/components/devices/connect/parts";
import type { ConnectFlow, InstallPath } from "@/components/devices/connect/useConnectFlow";
import { BOARDS, CHIPS, pinChoices, type SketchBoard } from "@/lib/firmware-sketch";
import { wireId } from "@/lib/wire-id";
import { tActive as tr } from "@iodriven/shared/i18n";
import { richT } from "@/lib/i18n";

/** Step 2: wiring (or board and pins, for the sketch), Wi-Fi and broker. */
export function OptionsStep({ flow }: { flow: ConnectFlow }) {
  const { install, phone, ssid, hostProblem, blocked } = flow;
  return (
    <>
      <h2 className="text-section font-semibold text-ink">{tr("connect.options")}</h2>
      {install ? <InstallLead flow={flow} install={install} /> : <SketchLead flow={flow} />}
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          {install ? (
            <WiringCard flow={flow} install={install} />
          ) : (
            <OptionGroup
              label={tr("connect.board")}
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
      <StepNav state={tr("connect.optionsState")} onBack={() => flow.setStep(1)} onNext={() => flow.setStep(3)} nextDisabled={blocked || (!phone && !ssid) || hostProblem != null} />
    </>
  );
}

function InstallLead({ flow, install }: { flow: ConnectFlow; install: InstallPath }) {
  return (
    <p className="text-sm text-ink-muted">
      {richT(tr, "connect.installLead", {
        version: <b className="text-ink">{install.firmware.version}</b>,
        wiring: flow.device.hardware ? tr("connect.ownWiringLower") : <>{richT(tr, "connect.templateWiringOf", { template: <b className="text-ink">{flow.template.name}</b> })}</>,
      })}
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
        {richT(tr, "connect.sketchLead", { template: <b className="text-ink">{template.name}</b> })}
      </p>
      <Callout>
        {wiring && flow.firmwarePublished ? (
          <>
            {richT(tr, "connect.unknownBoard", {
              board: <code className="font-mono">{wiring.board}</code>,
              link: (
                <Link href={device.hardware ? deviceWiringHref : templateWiringHref} className="text-accent hover:underline">
                  {device.hardware ? tr("connect.thisDevicesWiring") : tr("connect.theTemplatesWiring")}
                </Link>
              ),
            })}
          </>
        ) : wiring ? (
          tr("connect.noRelease")
        ) : (
          <>
            {richT(tr, "connect.noWiringLead", {
              templateLink: (
                <Link href={templateWiringHref} className="text-accent hover:underline">
                  {tr("connect.templateLinkText", { template: template.name })}
                </Link>
              ),
              deviceLink: (
                <Link href={deviceWiringHref} className="text-accent hover:underline">
                  {tr("connect.deviceAlone")}
                </Link>
              ),
            })}
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
          {tr("connect.wiring")} {device.hardware && <Tag size="sm">{tr("connect.ownTag")}</Tag>}
        </span>
        <span className="flex gap-3 text-xs">
          <Link href={deviceWiringHref} className="text-accent hover:underline">
            {device.hardware ? tr("connect.changeWiring") : tr("connect.wireDifferently")}
          </Link>
          {!device.hardware && (
            <Link href={templateWiringHref} className="text-accent hover:underline">
              {tr("connect.editTemplates", { devices: tr("common.deviceCount", { count: template.device_count }) })}
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
            { header: tr("connect.pin"), render: (r) => <span className="font-mono">{r.name}</span>, className: "w-36" },
            { header: tr("connect.connectsTo"), render: (r) => r.to },
          ]}
          rows={guide.pins}
          rowKey={(r) => `${r.pin}-${r.role}-${r.to}`}
        />
      ) : (
        <p className="text-sm text-ink-muted">{tr("connect.nothingWired")}</p>
      )}
      {unlinkedPins.length > 0 && (
        <Callout tone="warning">
          {richT(tr, unlinkedPins.length === 1 ? "connect.unlinkedOne" : "connect.unlinkedMany", {
            link: (
              <Link href={device.hardware ? deviceWiringHref : templateWiringHref} className="text-accent hover:underline">
                {tr("connect.theWiring")}
              </Link>
            ),
          }, { pins: unlinkedPins.join(", ") })}
        </Callout>
      )}
    </div>
  );
}

function WifiOptions({ flow }: { flow: ConnectFlow }) {
  return (
    <>
      <OptionGroup
        label={tr("connect.wifi")}
        value={flow.phone ? "ble" : "sketch"}
        onChange={(v) => flow.setWifiMode(v as "ble" | "sketch")}
        options={
          flow.phoneSetup
            ? [
                [
                  "ble",
                  tr("connect.fromPhone"),
                  tr("connect.fromPhoneHint"),
                ],
                flow.install
                  ? ["sketch", tr("connect.typeIn"), tr("connect.typeInHint")]
                  : ["sketch", tr("connect.typeInSketch"), tr("connect.typeInSketchHint")],
              ]
            : // No Bluetooth on this board: the only way in (DESIGN.md §8).
              [["sketch", tr("connect.typeIn"), tr("connect.noBluetooth")]]
        }
      />
      {!flow.phone && (
        <div className="grid grid-cols-2 gap-2">
          {!flow.phoneSetup && (
            <p className="col-span-2 text-xs text-ink-muted">{tr("connect.savedOnBoard")}</p>
          )}
          <Field label={tr("connect.network")}>
            <Input value={flow.ssid} autoComplete="off" onChange={(e) => flow.setSsid(e.target.value)} />
          </Field>
          <Field label={tr("connect.password")}>
            <PasswordInput aria-label={tr("connect.wifiPassword")} value={flow.wifiPassword} autoComplete="off" onChange={(e) => flow.setWifiPassword(e.target.value)} />
          </Field>
        </div>
      )}
    </>
  );
}

/** Where the board connects. Filled in for this server and over TLS, so most
 * people never open it; it opens by itself when something needs a look. */
function BrokerOptions({ flow }: { flow: ConnectFlow }) {
  return (
    <details open={flow.hostProblem != null || !flow.tls} className="overflow-hidden rounded-lg border border-border">
      <summary className="cursor-pointer bg-surface-raised px-3 py-2 text-meta text-ink">
        {tr("connect.advanced")} <span className="text-ink-muted">· {flow.host || "…"}, {flow.tls ? tr("connect.secure") : tr("connect.notSecure")}</span>
      </summary>
      <div className="flex flex-col gap-4 p-4">
      <Field label={tr("connect.brokerHost")} error={flow.hostProblem ?? undefined} hint={tr("connect.brokerHint")}>
        <Input mono value={flow.host} autoComplete="off" spellCheck={false} onChange={(e) => flow.setHost(e.target.value)} />
      </Field>
      <OptionGroup
        label={tr("connect.connection")}
        value={flow.tls ? "tls" : "plain"}
        onChange={(v) => flow.setTls(v === "tls")}
        options={[
          ["tls", tr("connect.tls"), tr("connect.tlsHint")],
          ["plain", tr("connect.plain"), tr("connect.plainHint")],
        ]}
      />
      {!flow.tls && (
        <p className="flex gap-1.5 text-xs text-status-pending">
          <AlertTriangle aria-hidden size={13} className="mt-0.5 shrink-0" />
          {tr("connect.noTls")}
        </p>
      )}
      </div>
    </details>
  );
}

function InstallSummary({ flow, install }: { flow: ConnectFlow; install: InstallPath }) {
  const { phone, security, name, ssid, tls, host, checkedMetrics, boolActuators } = flow;
  return (
    <div className="rounded-lg bg-canvas px-3.5 py-3 text-meta">
      <p className="mb-1 font-medium text-ink">{tr("connect.boardGets")}</p>
      <ul className="list-disc pl-5 text-ink-muted">
        <li>
          {tr("connect.firmwareFor", { version: install.firmware.version, board: install.model.label })}
        </li>
        <li>
          {phone
            ? tr("connect.wifiPhone", { security, name })
            : tr("connect.wifiTyped", { ssid: ssid || "…" })}
        </li>
        {phone && <li>{tr("connect.newWifiLater", { button: install.model.reset.label })}</li>}
        <li>
          {tr("connect.mqttWired", {
            transport: tr(tls ? "connect.tls" : "connect.plain"),
            host: host || "…",
            metrics: tr("connect.metrics", { count: checkedMetrics.length }),
            actuators: tr("connect.actuators", { count: boolActuators.length }),
          })}
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
          <legend className="mb-1 text-meta font-medium text-ink">{tr("connect.pins")}</legend>
          {[...metrics.filter((m) => m.data_type === "bool").map((m) => [`m:${wireId(m)}`, m.name, tr("connect.input")] as const), ...boolActuators.map((a) => [`a:${wireId(a)}`, a.name, tr("connect.output")] as const)].map(([k, label, dir]) => (
            <div key={k} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-2">
              <span className="min-w-0 text-sm text-ink">
                {label} <small className="font-mono text-ink-muted">{k.slice(2)} · {dir}</small>
              </span>
              <Select
                aria-label={tr("connect.gpioFor", { name: label })}
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
        <p className="mb-1 font-medium text-ink">{tr("connect.sketchIncludes")}</p>
        <ul className="list-disc pl-5 text-ink-muted">
          <li>
            {tr("connect.arduinoBoard", { board: boardInfo.label, arduino: boardInfo.arduinoBoard })}{boardInfo.ideSettings.length ? `, ${boardInfo.ideSettings.join(", ")}` : ""}
          </li>
          <li>
            {phone
              ? tr("connect.sketchPhone", { security, name })
              : tr("connect.sketchWifi")}
          </li>
          {phone && <li>{tr("connect.newWifiLater", { button: boardInfo.resetButton })}</li>}
          <li>
            {tr("connect.mqttSketch", {
              transport: tr(tls ? "connect.tls" : "connect.plain"),
              metrics: tr("connect.metrics", { count: metrics.length }),
              actuators: tr("connect.actuators", { count: actuators.length }),
            })}
          </li>
        </ul>
      </div>
    </>
  );
}
