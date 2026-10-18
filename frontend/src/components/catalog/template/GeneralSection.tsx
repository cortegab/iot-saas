"use client";

import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { SwitchField } from "@/components/ui/Switch";
import { EditorSection } from "@/components/editor/EditorFrame";
import type { SectionProps } from "@/components/catalog/template/section-props";
import type { components } from "@/types/api";

type ZoneResponse = components["schemas"]["ZoneResponse"];

/** Names and availability; when onboarding, the device's name and zone too. */
export function GeneralSection({ zones, ...props }: SectionProps & { zones?: ZoneResponse[] }) {
  const { d, set, f, blur, readOnly } = props;
  const device = d.device;
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
