"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Construction } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useApiSWR } from "@/hooks/useApiSWR";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useStarterDashboard } from "@/components/dashboards/useStarterDashboard";
import { usePermissions } from "@/hooks/usePermissions";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatReading } from "@/lib/format-reading";
import { HOME } from "@/lib/landing";
import { timeAgo } from "@/lib/time-ago";
import type { components } from "@/types/api";

type SetupStatusResponse = components["schemas"]["SetupStatusResponse"];
type TelemetryLatestResponse = components["schemas"]["TelemetryLatestResponse"];

interface Step {
  key: "template" | "device" | "rule" | "dashboard" | "invite";
  title: string;
  why: string;
  href: string;
  action: string;
  /** What it's waiting for, while an earlier step isn't done. */
  needs?: string;
}

/** Get started (DESIGN.md §10.x): a new workspace's way to a first working
 * loop. Each step is read from data, never ticked by hand, so the list can't
 * drift: delete the only device and its step reopens. Each row opens the real
 * page for it. Owners and admins land here after signing in until the four
 * steps are done or someone dismisses it; viewers see that it's being set up. */
export default function GetStartedPage() {
  const router = useRouter();
  const api = useApi();
  const toast = useToast();
  const { can } = usePermissions();
  const manages = can("workspace.setup");
  const build = useStarterDashboard();
  const { data: ws } = useWorkspace();

  // The dashboard step's shortcut (DESIGN.md §10.2): one made from the devices.
  async function buildFromDevices() {
    try {
      const id = await build(`${ws?.name ?? "My"} overview`);
      toast({ title: "Dashboard built", detail: "A chart for each device, set as where you land." });
      router.push(`/dashboards/${id}`);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't build the dashboard", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }
  // Polled while the device step waits: it turns done when a first reading arrives.
  const { data: setup, error, mutate } = useApiSWR<SetupStatusResponse>("/tenants/current/setup", { refreshInterval: (s) => (s?.device ? 0 : 5_000) });

  async function dismiss() {
    try {
      await api.post("/tenants/current/setup/dismiss");
      toast({ title: "Get started dismissed", detail: "It's in Workspace settings if you want it back." });
      router.replace(HOME);
    } catch (err) {
      toast({ tone: "error", title: "Couldn't dismiss it", detail: err instanceof ApiRequestError ? err.message : undefined });
    }
  }

  const header = (
    <PageHeader
      title="Get started"
      description="Four steps to a working loop: a device's readings, checked by a rule, on your dashboard."
      actions={
        manages && setup && !setup.complete ? (
          <Button variant="ghost" onClick={() => void dismiss()}>
            I&apos;ll set it up myself
          </Button>
        ) : undefined
      }
    />
  );

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <ErrorState message={error instanceof ApiRequestError ? error.message : "The API didn't respond."} onRetry={() => void mutate()} />
      </div>
    );
  }
  if (!setup) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <LoadingSkeleton rows={4} rowClassName="h-16" />
      </div>
    );
  }
  if (!manages) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState
          icon={<Construction aria-hidden size={26} />}
          title="Your workspace is being set up"
          description="An owner or admin is adding its devices and rules. What's there already is yours to look at."
          action={
            <Link href="/devices" className={buttonClassName({ variant: "secondary" })}>
              Look at devices
            </Link>
          }
        />
      </div>
    );
  }

  const device = setup.first_device_id;
  const steps: Step[] = [
    { key: "template", title: "Create a device template", why: "What a kind of device sends and what it can switch.", href: "/templates/new", action: "New template" },
    { key: "device", title: "Connect a device", why: "Done when it sends its first reading.", href: "/devices/new", action: "Add device", needs: setup.template ? undefined : "Needs a template" },
    {
      key: "rule",
      title: "Create a rule",
      why: "Checks every reading the moment it arrives and acts in under two seconds.",
      href: device ? `/rules/new?device=${device}` : "/rules/new",
      action: "New rule",
      needs: setup.device ? undefined : "Needs a connected device",
    },
    { key: "dashboard", title: "Make a dashboard", why: "Your own view of the readings, live.", href: "/dashboards/new", action: "New dashboard" },
  ];
  const current = steps.find((s) => !setup[s.key])?.key;

  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      {header}
      {setup.complete && (
        <Callout tone="info" title="Setup complete">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>From now on you&apos;ll land on your dashboard after signing in.</span>
            <Link href={HOME} className={buttonClassName({ size: "sm" })}>
              Open your dashboard
            </Link>
          </span>
        </Callout>
      )}
      <ol aria-label="Setup steps" className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
        {steps.map((s, i) => (
          <StepRow key={s.key} n={i + 1} step={s} done={setup[s.key]} current={s.key === current}>
            {s.key === "device" && device && <FirstReading deviceId={device} deviceName={setup.first_device_name ?? "Your device"} />}
            {s.key === "dashboard" && !setup.dashboard && device && (
              <Button variant="link" className="w-fit text-meta" onClick={() => void buildFromDevices()}>
                Or build one from my devices
              </Button>
            )}
          </StepRow>
        ))}
      </ol>
      <h2 className="pt-2 text-meta font-medium text-ink-muted">Optional</h2>
      <ol aria-label="Optional steps" className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
        <StepRow
          step={{ key: "invite", title: "Invite your team", why: "They get their own dashboards and the alerts you share.", href: "/members/invite", action: "Invite" }}
          done={setup.invite}
          current={false}
        />
      </ol>
    </div>
  );
}

function StepRow({ n, step, done, current, children }: { n?: number; step: Step; done: boolean; current: boolean; children?: React.ReactNode }) {
  return (
    <li className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-border-soft px-3.5 py-3 first:border-t-0", current && "shadow-[inset_3px_0_0_var(--color-accent)]")}>
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums",
          done ? "border-status-online bg-status-online text-on-accent" : current ? "border-accent text-accent" : "border-border text-ink-muted",
        )}
      >
        {done ? <Check size={13} /> : (n ?? "·")}
      </span>
      <div className="flex min-w-0 flex-1 basis-[260px] flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">
          <span className="sr-only">{done ? "Done: " : current ? "Next: " : ""}</span>
          {step.title}
        </span>
        <span className="text-meta text-ink-muted">{done ? step.why : (step.needs ?? step.why)}</span>
        {children}
      </div>
      <Link href={step.href} className={cn(buttonClassName({ variant: current ? "primary" : "secondary", size: "sm" }), "ml-auto shrink-0")}>
        {done ? "Open" : step.action}
      </Link>
    </li>
  );
}

/** The moment it works: the first device's latest reading, kept live by
 * realtime (it revalidates this key). */
function FirstReading({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
  const { data } = useApiSWR<TelemetryLatestResponse[]>(`/devices/${deviceId}/latest`, { refreshInterval: 20_000 });
  const r = data?.slice().sort((a, b) => b.time.localeCompare(a.time))[0];
  if (!r) return null;
  return (
    <span className="mt-1 inline-flex w-fit flex-wrap items-baseline gap-x-1.5 rounded-md bg-accent-muted px-2 py-1 text-meta text-ink">
      <b className="font-medium">{deviceName}</b> · {r.metric} <b className="font-semibold tabular-nums">{formatReading(r.value)}</b>
      <span className="text-ink-muted">· {timeAgo(r.time)}</span>
    </span>
  );
}
