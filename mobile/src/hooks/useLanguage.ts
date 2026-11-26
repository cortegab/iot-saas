import type { components } from "@iodriven/shared/api";
import { useCallback, useEffect } from "react";
import { savedLocale, useApplyLocale, useLocale, type Locale } from "@/i18n/I18nProvider";
import { useApi } from "./useApi";
import { useApiSWR } from "./useApiSWR";

type UserResponse = components["schemas"]["UserResponse"];

/** This person's language (DESIGN.md §11a), the web's useLanguage: saved on
 * the account (null = follow the phone), shared with the web and emails. */
export function useLanguage(): { locale: Locale; choice: Locale | null; setChoice: (next: Locale | null) => Promise<void> } {
  const api = useApi();
  const apply = useApplyLocale();
  const locale = useLocale();
  const { data: user, mutate } = useApiSWR<UserResponse>("/auth/me");
  const choice = savedLocale(user?.locale);
  const setChoice = useCallback(
    async (next: Locale | null) => {
      const before = user;
      apply(next);
      if (before) void mutate({ ...before, locale: next }, { revalidate: false });
      try {
        const saved = await api.patch<UserResponse>("/auth/me", { locale: next });
        void mutate(saved, { revalidate: false });
      } catch {
        apply(savedLocale(before?.locale));
        if (before) void mutate(before, { revalidate: false });
      }
    },
    [api, apply, mutate, user],
  );
  return { locale, choice, setChoice };
}

/** Applies the account's saved language once it's known (mounted in the
 * signed-in layout), so a choice made on the web follows the person here. */
export function LocaleSync(): null {
  const { data: user } = useApiSWR<UserResponse>("/auth/me");
  const apply = useApplyLocale();
  const locale = useLocale();
  const saved = savedLocale(user?.locale);
  useEffect(() => {
    if (saved && saved !== locale) apply(saved);
    // Only when the saved choice arrives or changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);
  return null;
}
