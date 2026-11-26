"use client";

import { ChoiceCards } from "@/components/ui/ChoiceCards";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { SwitchField } from "@/components/ui/Switch";
import { EditorSection } from "@/components/editor/EditorFrame";
import type { SectionProps } from "@/components/catalog/template/section-props";
import { blankHardware } from "@/lib/hardware/hardware-draft";
import { blankMetric, type RunsOn } from "@/lib/template-draft";
import type { components } from "@/types/api";
import { tActive as tr } from "@iodriven/shared/i18n";

type ZoneResponse = components["schemas"]["ZoneResponse"];

/** Names and availability, then how the devices run (DESIGN.md §8, demo H:
 * the names first, Runs on as two cards); when onboarding, the device's name
 * and zone instead of the template's. */
export function GeneralSection({ zones, ...props }: SectionProps & { zones?: ZoneResponse[] }) {
  const { d, set, f, blur, readOnly } = props;
  const device = d.device;

  function setRunsOn(runsOn: RunsOn) {
    set({
      ...d,
      runsOn,
      // Custom firmware lists its data by hand: start it with a metric to fill in.
      metrics: runsOn === "own_code" && d.metrics.length === 0 ? [blankMetric()] : d.metrics,
      // A new device on our firmware starts at the board, ready for its first part.
      hardware: device && runsOn === "generic_firmware" && !d.hardware ? blankHardware() : d.hardware,
    });
  }

  return (
    <EditorSection id="general" title={tr("tpls.general")}>
      <div className="grid gap-3.5 @[640px]:grid-cols-2">
        {device && (
          <>
            <Field label={tr("tpls.deviceName")} hint={tr("tpls.deviceNameHint")} {...f("general.device")}>
              <Input
                autoFocus
                value={device.name}
                disabled={readOnly}
                placeholder={tr("tpls.deviceNamePlaceholder")}
                onChange={(e) => {
                  const next = { ...device, name: e.target.value };
                  set({ ...d, device: next, name: next.templateNameAuto ? e.target.value : d.name });
                }}
                onBlur={blur("general.device")}
              />
            </Field>
            {zones && zones.length > 0 && (
              <Field label={tr("tpls.zone")} optional>
                <Select value={device.zoneId} disabled={readOnly} onChange={(e) => set({ ...d, device: { ...device, zoneId: e.target.value } })}>
                  <option value="">{tr("tpls.noZone")}</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        )}
        {/* Onboarding names the template after the device and keeps it out of
            view (DESIGN.md §8), unless that name needs fixing. */}
        {(!device || f("general.name").error) && (
          <Field
            label={tr("tpls.templateName")}
            hint={device ? tr("tpls.templateNameHint") : undefined}
            {...f("general.name")}
          >
            <Input
              value={d.name}
              disabled={readOnly}
              placeholder={tr("tpls.templateNamePlaceholder")}
              onChange={(e) => set({ ...d, name: e.target.value, ...(device ? { device: { ...device, templateNameAuto: false } } : {}) })}
              onBlur={blur("general.name")}
            />
          </Field>
        )}
        {!device && (
          <SwitchField
            label={tr("tpls.status")}
            checked={d.enabled}
            disabled={readOnly}
            onChange={(enabled) => set({ ...d, enabled })}
            onLabel={tr("tpls.enabled")}
            offLabel={tr("tpls.disabled")}
            onHint={tr("tpls.onHint")}
            offHint={tr("tpls.offHint")}
          />
        )}
      </div>
      {/* Not a Field: its <label> would name the first card "Runs on". */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-muted">{tr("tpls.runsOn")}</span>
        <ChoiceCards<RunsOn>
          ariaLabel={tr("tpls.runsOn")}
          value={d.runsOn}
          onChange={setRunsOn}
          options={[
            { value: "generic_firmware", title: tr("tpls.ourFirmware"), description: tr("tpls.ourFirmwareHint"), disabled: readOnly },
            { value: "own_code", title: tr("tpls.customFirmware"), description: tr("tpls.customFirmwareHint"), disabled: readOnly },
          ]}
        />
        {d.runsOn === "own_code" && d.hardware && (
          <p className="text-xs text-status-pending">{tr("tpls.dropsWiring")}</p>
        )}
      </div>
    </EditorSection>
  );
}
