import { describe, expect, it } from "vitest";
import { createT, format, formatDate, formatNumber, formatTime, parseAcceptLanguage, pickLocale, setRegion } from "./i18n";
import { en } from "./i18n/en";
import { es } from "./i18n/es";

function leaves(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

describe("catalogs", () => {
  it("Spanish has exactly the English keys", () => {
    expect(leaves(es).sort()).toEqual(leaves(en).sort());
  });
  it("Spanish strings use only the English placeholders (some drop a noun Spanish doesn't need)", () => {
    // Placeholders only: "{name}" or "{name, plural, …}", not a plural branch.
    const names = (s: string) => [...s.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]).sort();
    const enMap = new Map(leaves(en).map((k) => [k, k.split(".").reduce<unknown>((n, p) => (n as Record<string, unknown>)[p], en) as string]));
    for (const key of leaves(es)) {
      const esText = key.split(".").reduce<unknown>((n, p) => (n as Record<string, unknown>)[p], es) as string;
      const allowed = new Set(names(enMap.get(key)!));
      for (const n of names(esText)) expect(allowed.has(n), `${key}: {${n}}`).toBe(true);
    }
  });
});

describe("pickLocale", () => {
  it("prefers a saved choice", () => expect(pickLocale("es", ["en-US"])).toBe("es"));
  it("follows any Spanish-speaking browser", () => {
    for (const tag of ["es", "es-MX", "es-419", "es_AR", "ES-co"]) expect(pickLocale(null, [tag])).toBe("es");
  });
  it("takes the first language it has", () => expect(pickLocale(null, ["fr-FR", "es-CL", "en"])).toBe("es"));
  it("defaults to English", () => {
    expect(pickLocale(null, ["fr-FR", "de"])).toBe("en");
    expect(pickLocale(undefined, [])).toBe("en");
    expect(pickLocale("xx", ["pt-BR"])).toBe("en");
  });
});

describe("parseAcceptLanguage", () => {
  it("orders by quality", () => expect(parseAcceptLanguage("en;q=0.5, es-MX, fr;q=0.8")).toEqual(["es-MX", "fr", "en"]));
  it("drops * and q=0", () => expect(parseAcceptLanguage("*, de;q=0, es")).toEqual(["es"]));
  it("handles nothing", () => expect(parseAcceptLanguage(null)).toEqual([]));
});

describe("t", () => {
  const tEn = createT("en");
  const tEs = createT("es");
  it("interpolates", () => {
    expect(tEn("shell.roleOf", { role: "Owner", workspace: "Bay" })).toBe("Owner of Bay");
    expect(tEs("shell.roleOf", { role: "Propietario", workspace: "Bay" })).toBe("Propietario de Bay");
  });
  it("pluralizes", () => {
    expect(tEn("common.deviceCount", { count: 1 })).toBe("1 device");
    expect(tEn("common.deviceCount", { count: 0 })).toBe("0 devices");
    expect(tEs("common.deviceCount", { count: 1 })).toBe("1 dispositivo");
    expect(tEs("common.deviceCount", { count: 2 })).toBe("2 dispositivos");
  });
  it("keeps an unknown placeholder visible", () => expect(format("en", "Hi {name}", {})).toBe("Hi {name}"));
  it("supports exact plural branches", () => expect(format("en", "{n, plural, =0 {none} one {one} other {#}}", { n: 0 })).toBe("none"));
});

describe("formatting", () => {
  it("formats numbers the way the reader's country does", () => {
    setRegion([]);
    expect(formatNumber("es", 27.4)).toBe("27.4");
    setRegion(["es-AR", "en"]);
    expect(formatNumber("es", 27.4)).toBe("27,4");
    setRegion(["fr-FR", "es_MX"]);
    expect(formatNumber("es", 27.4)).toBe("27.4");
    setRegion(["not a tag", "es-zz-bad tag"]);
    expect(formatNumber("es", 27.4)).toBe("27.4");
    expect(formatNumber("en", 27.4)).toBe("27.4");
  });
  it("writes dates and 24-hour times", () => {
    const d = Date.UTC(2026, 10, 25, 14, 5);
    expect(formatDate("en", d, "UTC")).toBe("Nov 25, 2026");
    expect(formatDate("es", d, "UTC")).toMatch(/^25 nov\.? 2026$/);
    expect(formatTime("es", d, "UTC")).toBe("14:05");
  });
});
