"use client";

import { useRef, type ReactNode } from "react";
import { OnboardingJourney, useJourney } from "@/components/marketing/OnboardingJourney";
import { Steps } from "@/components/marketing/Steps";

const STEPS: [string, string][] = [
  ["Create a workspace", "The tenant is provisioned in the same step. Invite your team as Admins or Viewers."],
  ["Define a device template", "The metrics it reports, the actuators it drives, units and ranges."],
  ["Copy the generated sketch", "Topics, TLS and the device's credential are already filled in. Wi-Fi can be set up from a phone by scanning a QR code."],
  ["Flash it", "The connect page turns green as the board reports in, and any armed rule is already watching."],
];

/** The Onboarding section's body (DESIGN.md §10): the four steps beside the
 * journey figure, the step the figure is showing highlighted in the list. */
export function OnboardingSection({ heading }: { heading: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const stage = useJourney(ref);

  return (
    <div ref={ref} className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div>
        {heading}
        <div className="mt-8">
          <Steps vertical steps={STEPS} active={stage} />
        </div>
      </div>
      <div className="flex flex-col gap-3 lg:sticky lg:top-[90px]">
        <OnboardingJourney stage={stage} />
        <p className="text-[13.5px] leading-relaxed text-ink-muted">
          Ten minutes, start to finish: by step 4 the device is online and any armed rule is already watching.
        </p>
      </div>
    </div>
  );
}
