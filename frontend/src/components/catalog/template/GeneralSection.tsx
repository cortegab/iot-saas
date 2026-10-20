"use client";

import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SwitchField } from "@/components/ui/Switch";
import { EditorSection } from "@/components/editor/EditorFrame";
import type { SectionProps } from "@/components/catalog/template/section-props";
import { blankMetric, type RunsOn } from "@/lib/template-draft";
import type { components } from "@/types/api";

type ZoneResponse = components["schemas"]["ZoneResponse"];

/** Names and availability; when onboarding, the device's name and zone too. */
export function GeneralSection({ zones, ...props }: SectionProps & { zones?: ZoneResponse[] }) {
  const { d, set, f, blur, readOnly } = props;
  const device = d.device;
  return (
    <EditorSection id="general" title="General">
      <Field
        label="Runs on"
        hint={
          d.runsOn === "generic_firmware"
            ? "Our firmware: pick the board and its parts, and every device installs from the browser with no code."
            : d.hardware
              ? "Saving drops the wiring: these devices run code of their own."
              : "Your own code on the board: list the data it sends. Devices get a sketch, or the topics to publish to (a gateway that speaks MQTT works too)."
        }
      >
        <SegmentedControl<RunsOn>
          ariaLabel="Runs on"
          size="md"
          className="w-fit"
          value={d.runsOn}
          // Own code lists its data by hand: start it with a metric to fill in.
          onChange={(runsOn) => set({ ...d, runsOn, metrics: runsOn === "own_code" && d.metrics.length === 0 ? [blankMetric()] : d.metrics })}
          options={[
            { value: "generic_firmware", label: "Our firmware", disabled: readOnly },
            { value: "own_code", label: "Custom firmware", disabled: readOnly },
          ]}
        />
      </Field>
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
    </EditorSection>
  );
}
