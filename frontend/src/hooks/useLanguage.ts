"use client";

import { useCallback, useEffect } from "react";
import { useApi } from "@/hooks/useApi";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useToast } from "@/components/ui/Toast";
import { savedLocale, useApplyLocale, useLocale, useT, type Locale } from "@/lib/i18n";
import type { components } from "@/types/api";

type UserResponse = components["schemas"]["UserResponse"];

/**
 * This person's language (DESIGN.md §11a): `choice` is what they saved on
 * their account (null = follow the browser), `locale` what's on screen.
 * `setChoice` shows the change at once, saves it, and goes back with a toast
 * if it can't be saved.
 */
export function useLanguage(): { locale: Locale; choice: Locale | null; setChoice: (next: Locale | null) => Promise<void> } {
  const api = useApi();
  const toast = useToast();
  const t = useT();
  const locale = useLocale();
  const apply = useApplyLocale();
  const { data: user, mutate } = useCurrentUser();
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
        toast({ tone: "error", title: t("language.saveFailed"), detail: t("language.saveFailedDetail") });
      }
    },
    [api, apply, mutate, t, toast, user],
  );

  return { locale, choice, setChoice };
}

/** Applies the account's saved language once it's known, so a choice made on
 * another device follows the person here (mounted once, in the app shell). */
export function LocaleSync(): null {
  const { data: user } = useCurrentUser();
  const apply = useApplyLocale();
  const locale = useLocale();
  const saved = savedLocale(user?.locale);
  useEffect(() => {
    if (saved && saved !== locale) apply(saved);
    // Only when the saved choice arrives or changes, not on every switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);
  return null;
}
