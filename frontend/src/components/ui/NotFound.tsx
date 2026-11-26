import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApiRequestError } from "@/lib/api-client";
import { nounWord, tActive as t } from "@iodriven/shared/i18n";

/** A record page whose record doesn't exist (DESIGN.md §5): what happened and
 * the way back — never an error with Retry, which can't bring it back. */
export function NotFound({ noun, href, list, description }: { noun: string; href: string; list: string; description?: string }) {
  return (
    <EmptyState
      title={t("frame.missingTitle", { noun })}
      description={description ?? t("frame.missingBody")}
      action={
        <Link href={href} className={buttonClassName({ variant: "secondary" })}>
          {t("frame.backTo", { list: nounWord(list) })}
        </Link>
      }
    />
  );
}

/** True for the API's "no such record" answer. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404;
}
