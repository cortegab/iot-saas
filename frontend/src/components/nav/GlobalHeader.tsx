import Link from "next/link";
import { NotificationBell } from "@/components/nav/NotificationBell";
import { UserMenu } from "@/components/nav/UserMenu";

export function GlobalHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
      <Link href="/devices" className="text-sm font-semibold text-ink">
        iot-saas
      </Link>
      <div className="flex items-center gap-2">
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
