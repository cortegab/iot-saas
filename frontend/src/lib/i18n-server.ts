import { cookies, headers } from "next/headers";
import { createT, parseAcceptLanguage, pickLocale, type Locale, type T } from "@iodriven/shared/i18n";

/** The language a server component renders in (DESIGN.md §11a): the
 * `iod.lang` cookie (the person's choice), else the browser's
 * Accept-Language, else English. Reading the request makes the page render
 * per request. */
export async function serverLocale(): Promise<Locale> {
  const [jar, head] = await Promise.all([cookies(), headers()]);
  return pickLocale(jar.get("iod.lang")?.value, parseAcceptLanguage(head.get("accept-language")));
}

export async function serverT(): Promise<{ locale: Locale; t: T }> {
  const locale = await serverLocale();
  return { locale, t: createT(locale) };
}
