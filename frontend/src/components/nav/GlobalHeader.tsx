import Link from "next/link";
import { MobileNavTrigger } from "@/components/nav/MobileNavTrigger";
import { NotificationBell } from "@/components/nav/NotificationBell";
import { UserMenu } from "@/components/nav/UserMenu";

export function GlobalHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4 md:px-6">
      <div className="flex items-center gap-2">
        <MobileNavTrigger />
        <Link href="/devices" className="flex items-center gap-2 text-ink">
          <span
            aria-hidden
            className="grid h-6 w-6 place-items-center rounded-[5px] border-[1.5px] border-current"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
          <span className="font-display text-base font-bold tracking-tight">iodriven</span>
        </Link>
      </div>
      <div className="flex items-center gap-2">
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
