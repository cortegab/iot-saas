"use client";

import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createT, isLocale, pickLocale, setRegion, type Locale, type T } from "@iodriven/shared/i18n";

export { type Locale, type MessageKey, type T } from "@iodriven/shared/i18n";

/** The cookie the server reads to render the right language on first paint
 * (DESIGN.md §11a). Absent = follow the browser's Accept-Language. */
export const LANG_COOKIE = "iod.lang";

let current: Locale = "en";
/** The language on screen, for code outside React (the API client's
 * Accept-Language header). */
export function currentLocale(): Locale {
  return current;
}

function writeCookie(locale: Locale | null): void {
  try {
    document.cookie =
      locale === null
        ? `${LANG_COOKIE}=; path=/; max-age=0; samesite=lax`
        : `${LANG_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // A convenience for the next first paint; the server holds the choice.
  }
}

/** The browser's own preference, ignoring any saved choice. */
export function browserLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  return pickLocale(null, navigator.languages?.length ? navigator.languages : [navigator.language]);
}

interface I18nValue {
  locale: Locale;
  t: T;
  /** Show this language now and remember it in this browser; null goes back
   * to the browser's own language. Saving it to the account is the caller's
   * job (useLanguage). */
  apply: (choice: Locale | null) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Translations for the web (DESIGN.md §11a). The server picks the first
 * language (the cookie, else Accept-Language) so the first paint is right;
 * the account's saved choice then corrects it once /auth/me answers.
 */
export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  current = locale;

  useEffect(() => {
    // Numbers and dates the way this reader's country writes them.
    if (typeof navigator !== "undefined") setRegion(navigator.languages ?? [navigator.language]);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const apply = useCallback((choice: Locale | null) => {
    writeCookie(choice);
    setLocale(choice ?? browserLocale());
  }, []);

  const value = useMemo(() => ({ locale, t: createT(locale), apply }), [locale, apply]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used inside <I18nProvider>");
  return ctx;
}

/** `t(key, params)` in the current language. */
export function useT(): T {
  return useI18n().t;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

export function useApplyLocale(): (choice: Locale | null) => void {
  return useI18n().apply;
}

/** A saved account choice, if it's a language we speak. */
export function savedLocale(value: unknown): Locale | null {
  return isLocale(value) ? value : null;
}

/**
 * A translated sentence with React nodes in its placeholders ("You're
 * invited to {workspace} as {role}." with both bold), so word order stays
 * the translation's. Plain `params` still format as in `t`.
 */
export function richT(t: T, key: Parameters<T>[0], nodes: Record<string, ReactNode>, params: Record<string, string | number> = {}): ReactNode[] {
  const marks: Record<string, string> = {};
  for (const name of Object.keys(nodes)) marks[name] = `\u0000${name}\u0000`;
  return t(key, { ...params, ...marks })
    .split("\u0000")
    .map((part, i) => (i % 2 === 1 && part in nodes ? <Fragment key={i}>{nodes[part]}</Fragment> : part));
}
