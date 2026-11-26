import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { activeLocale, createT, isLocale, pickLocale, setActiveLocale, setRegion, type Locale, type T } from "@iodriven/shared/i18n";

export { type Locale, type T } from "@iodriven/shared/i18n";

/** The phone's language tag ("es-MX"), from Hermes' Intl; no native module. */
export function phoneTag(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? "en";
  } catch {
    return "en";
  }
}

/** The phone's own language, ignoring any saved choice. */
export function phoneLocale(): Locale {
  return pickLocale(null, [phoneTag()]);
}

/** The language on screen, for code outside React (the API client). */
export function currentLocale(): Locale {
  return activeLocale();
}

interface I18nValue {
  locale: Locale;
  t: T;
  /** Show this language now; null goes back to the phone's. Saving it to
   * the account is useLanguage's job. */
  apply: (choice: Locale | null) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Translations for the app (DESIGN.md §11a), sharing the web's catalog.
 * Starts in the phone's language; the account's saved choice applies once
 * /auth/me answers (LocaleSync). Screens re-render on a change because the
 * app's navigator is keyed by the language.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    setRegion([phoneTag()]);
    return phoneLocale();
  });
  setActiveLocale(locale);
  const apply = useCallback((choice: Locale | null) => setLocale(choice ?? phoneLocale()), []);
  const value = useMemo(() => ({ locale, t: createT(locale), apply }), [locale, apply]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used inside <I18nProvider>");
  return ctx;
}

export function useT(): T {
  return useI18n().t;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

export function useApplyLocale(): (choice: Locale | null) => void {
  return useI18n().apply;
}

export function savedLocale(value: unknown): Locale | null {
  return isLocale(value) ? value : null;
}
