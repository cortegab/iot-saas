import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { FlashSpike } from "@/components/hardware/FlashSpike";

/** Bench page for the browser flasher. Not linked anywhere, and gone from
 * production builds. Outside the (app) shell on purpose: it needs no API, so it
 * also runs from a second dev server (another port isn't a CORS origin). */
export default function DevFlashPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 py-8">
      <PageHeader title="Flash a board" description="Dev only: the generic firmware plus a hand-written config, timed." />
      <FlashSpike />
    </div>
  );
}
