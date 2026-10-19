import type { EditorMode } from "@/components/editor/EditorFrame";
import type { RecordEditor } from "@/components/editor/useRecordEditor";
import type { KeyUsage, TemplateDraft } from "@/lib/template-draft";

/** Onboarding "from the hardware": the device created with the template. */
export interface OnboardDevice {
  name: string;
  zoneId: string;
  /** The template name still follows the device name (until edited). */
  templateNameAuto: boolean;
}
export type Draft = TemplateDraft & { device?: OnboardDevice };

/** What every template-editor section gets from the editor. */
export interface SectionProps {
  d: Draft;
  set: (next: Draft) => void;
  editor: Pick<RecordEditor<Draft>, "errors" | "visibleErrors" | "warningFor">;
  /** Error/warning props for a field path. */
  f: (path: string) => { error?: string; warning?: string };
  /** Blur handler for a field path (errors show once visited). */
  blur: (path: string) => () => void;
  readOnly: boolean;
  mode: EditorMode;
  /** Rules and widgets per saved key, for lock icons and rename warnings. */
  usage?: { metrics: Record<string, KeyUsage>; actuators: Record<string, KeyUsage> };
}
