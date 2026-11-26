"use client";

import { useRef, type ReactNode } from "react";
import { OnboardingJourney, useJourney } from "@/components/marketing/OnboardingJourney";
import { Steps } from "@/components/marketing/Steps";
import { marketingCopy } from "@/lib/marketing-copy";
import { useLocale } from "@/lib/i18n";


/** The Onboarding section's body (DESIGN.md §10): the four steps beside the
 * journey figure, the step the figure is showing highlighted in the list. */
export function OnboardingSection({ heading }: { heading: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const stage = useJourney(ref);
  const c = marketingCopy(useLocale());

  return (
    <div ref={ref} className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div>
        {heading}
        <div className="mt-8">
          <Steps vertical steps={c.onboarding.steps} active={stage} />
        </div>
      </div>
      <div className="flex flex-col gap-3 lg:sticky lg:top-[90px]">
        <OnboardingJourney stage={stage} />
        <p className="text-[13.5px] leading-relaxed text-ink-muted">
          {c.onboarding.footnote}
        </p>
      </div>
    </div>
  );
}
