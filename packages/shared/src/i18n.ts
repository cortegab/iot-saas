/**
 * Translations both apps share (DESIGN.md §11a). No library: a typed catalog
 * per language (`i18n/en.ts` is the source; `i18n/es.ts` must have exactly
 * its keys, or `tsc` fails), a `t(key, params)` with ICU-style plurals, and
 * locale-aware number and date formatting through `Intl`.
 *
 * Messages: "{name}" interpolates; "{count, plural, one {# device} other {#
 * devices}}" picks by `Intl.PluralRules` ("#" is the formatted count).
 * A key missing from a language falls back to English, then to the key.
 */
import { en, type Messages } from "./i18n/en";
import { es } from "./i18n/es";

export type Locale = "en" | "es";
export const LOCALES: readonly Locale[] = ["en", "es"];
export const DEFAULT_LOCALE: Locale = "en";
/** Each language by its own name, for the Language switch. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", es: "Español" };

const CATALOGS: Record<Locale, Messages> = { en, es };

/** "nav.devices"-style dotted paths to every string in the catalog. */
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;
export type Params = Record<string, string | number>;
export type T = (key: MessageKey, params?: Params) => string;

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "es";
}

/**
 * The language to show: a saved choice wins; otherwise the first preferred
 * language we have (any "es-*" is Spanish), else English.
 */
export function pickLocale(saved: string | null | undefined, preferred: readonly string[] = []): Locale {
  if (isLocale(saved)) return saved;
  for (const tag of preferred) {
    const base = tag.trim().toLowerCase().split(/[-_;]/)[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** The language tags of an Accept-Language header, best first. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, i) => {
      const [tag, ...rest] = part.trim().split(";");
      const q = rest.map((r) => r.trim()).find((r) => r.startsWith("q="));
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) || 0 : 1, i };
    })
    .filter((x) => x.tag && x.tag !== "*" && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.tag);
}

function lookup(catalog: unknown, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Index of the brace closing the one at `open`. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function plural(locale: Locale, spec: string, count: number): string {
  // spec: "one {…} other {…}" (also "=0 {…}")
  const branches = new Map<string, string>();
  let i = 0;
  while (i < spec.length) {
    const open = spec.indexOf("{", i);
    if (open < 0) break;
    const end = closing(spec, open);
    if (end < 0) break;
    branches.set(spec.slice(i, open).trim(), spec.slice(open + 1, end));
    i = end + 1;
  }
  const exact = branches.get(`=${count}`);
  const chosen = exact ?? branches.get(new Intl.PluralRules(locale).select(count)) ?? branches.get("other") ?? "";
  return chosen.replace(/#/g, formatNumber(locale, count));
}

/** Fills "{name}" and "{n, plural, …}" in a message. */
export function format(locale: Locale, message: string, params: Params = {}): string {
  let out = "";
  let i = 0;
  while (i < message.length) {
    const open = message.indexOf("{", i);
    if (open < 0) {
      out += message.slice(i);
      break;
    }
    const end = closing(message, open);
    if (end < 0) {
      out += message.slice(i);
      break;
    }
    out += message.slice(i, open);
    const body = message.slice(open + 1, end);
    const comma = body.indexOf(",");
    const name = (comma < 0 ? body : body.slice(0, comma)).trim();
    const value = params[name];
    if (comma >= 0 && body.slice(comma + 1).trim().startsWith("plural")) {
      const spec = body.slice(body.indexOf(",", comma + 1) + 1);
      out += plural(locale, spec, Number(value ?? 0));
    } else {
      out += value === undefined ? `{${name}}` : typeof value === "number" ? formatNumber(locale, value) : value;
    }
    i = end + 1;
  }
  return out;
}

/** A `t` for one language. */
export function createT(locale: Locale): T {
  return (key, params) => {
    const message = lookup(CATALOGS[locale], key) ?? lookup(CATALOGS.en, key) ?? key;
    return format(locale, message, params);
  };
}

/** English `t`. */
export const tEn: T = createT("en");

// The language on screen, for the shared wording helpers (status labels,
// rule sentences, time-ago…) so their many call sites need no `t` argument.
// Each app sets it from its provider and re-renders on a change.
let active: Locale = "en";
const tByLocale: Partial<Record<Locale, T>> = { en: tEn };

export function setActiveLocale(locale: Locale): void {
  active = locale;
}

export function activeLocale(): Locale {
  return active;
}

/** `t` in the language on screen. */
export const tActive: T = (key, params) => (tByLocale[active] ??= createT(active))(key, params);

// --- Formatting -------------------------------------------------------------

// Words are neutral Latin American Spanish; numbers and dates follow the
// reader's country, because it differs: Mexico writes 27.4, Argentina 27,4.
const INTL_LOCALE: Record<Locale, string> = { en: "en-US", es: "es-419" };

/**
 * Formats Spanish the way this reader's country does: call with the browser's
 * or phone's language tags ("es-AR" → 27,4). Without a Spanish tag, es-419.
 */
export function setRegion(tags: readonly string[]): void {
  const spanish = tags.find((tag) => pickLocale(null, [tag]) === "es" && /^es[-_][a-z0-9]+$/i.test(tag.trim()));
  let tag = "es-419";
  if (spanish) {
    try {
      tag = Intl.getCanonicalLocales(spanish.replace("_", "-"))[0] ?? tag;
    } catch {
      // A malformed tag keeps the default.
    }
  }
  INTL_LOCALE.es = tag;
}

/** A number in this language's style: 1,234.5 / 1.234,5. */
export function formatNumber(locale: Locale, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: 6, ...options }).format(value);
}

/** "25 Nov 2026" / "25 nov 2026". */
export function formatDate(locale: Locale, date: Date | string | number, timeZone?: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(date));
}

/** 24-hour time, "14:05" (DESIGN.md §11). */
export function formatTime(locale: Locale, date: Date | string | number, timeZone?: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(date));
}

/** "Mon 25 Nov, 14:05" / "lun 25 nov, 14:05". */
export function formatDateTime(locale: Locale, date: Date | string | number, timeZone?: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(date));
}

/** The BCP 47 tag `Intl` gets for this language (Latin American Spanish). */
export function intlLocale(locale: Locale): string {
  return INTL_LOCALE[locale];
}

/**
 * A record noun ("device", "device template", "API keys") in the active
 * language, for frames that say "Open {noun}" or "{total} {noun}". Unknown
 * nouns come back as given. Spanish phrases around it avoid gendered words.
 */
export function nounWord(noun: string): string {
  const key = `nouns.${noun.toLowerCase().replace(/\s+(\w)/g, (_m, c: string) => c.toUpperCase())}`;
  const word = tActive(key as MessageKey);
  return word === key ? noun : word;
}
