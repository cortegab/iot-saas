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
    <EditorSection id="general" title="General">
      <div className="grid gap-3.5 @[640px]:grid-cols-2">
        {device && (
          <>
            <Field label="Device name" hint="Shown in lists and alerts. Its MQTT id is made from it and never changes." {...f("general.device")}>
              <Input
                autoFocus
                value={device.name}
                disabled={readOnly}
                placeholder="e.g. bay1-climate"
                onChange={(e) => {
                  const next = { ...device, name: e.target.value };
                  set({ ...d, device: next, name: next.templateNameAuto ? e.target.value : d.name });
                }}
                onBlur={blur("general.device")}
              />
            </Field>
            {zones && zones.length > 0 && (
              <Field label="Zone" optional>
                <Select value={device.zoneId} disabled={readOnly} onChange={(e) => set({ ...d, device: { ...device, zoneId: e.target.value } })}>
                  <option value="">No zone</option>
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
            label="Template name"
            hint={device ? "Saved as a template too, so the next board like this one is Add device → From a template." : undefined}
            {...f("general.name")}
          >
            <Input
              value={d.name}
              disabled={readOnly}
              placeholder="e.g. Climate sensor v2"
              onChange={(e) => set({ ...d, name: e.target.value, ...(device ? { device: { ...device, templateNameAuto: false } } : {}) })}
              onBlur={blur("general.name")}
            />
          </Field>
        )}
        {!device && (
          <SwitchField
            label="Status"
            checked={d.enabled}
            disabled={readOnly}
            onChange={(enabled) => set({ ...d, enabled })}
            onLabel="Enabled"
            offLabel="Disabled"
            onHint="Offered in Add device."
            offHint="Hidden from Add device. Devices that already use it keep working."
          />
        )}
      </div>
      {/* Not a Field: its <label> would name the first card "Runs on". */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-muted">Runs on</span>
        <ChoiceCards<RunsOn>
          ariaLabel="Runs on"
          value={d.runsOn}
          onChange={setRunsOn}
          options={[
            { value: "generic_firmware", title: "Our firmware", description: "Pick the board and parts; installs from the browser.", disabled: readOnly },
            { value: "own_code", title: "Custom firmware", description: "List the data it sends; you write the firmware.", disabled: readOnly },
          ]}
        />
        {d.runsOn === "own_code" && d.hardware && (
          <p className="text-[12.5px] text-status-pending">Saving drops the wiring: these devices run code of their own.</p>
        )}
      </div>
    </EditorSection>
  );
}
