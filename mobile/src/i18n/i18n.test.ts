import { setActiveLocale, tActive } from "@iodriven/shared/i18n";
import { phoneLocale } from "./I18nProvider";

// DESIGN.md §11a: the app starts in the phone's language (any es-* is
// Spanish), until the account's saved choice says otherwise.
describe("the app's language", () => {
  const real = Intl.DateTimeFormat;
  afterEach(() => {
    (Intl as { DateTimeFormat: typeof Intl.DateTimeFormat }).DateTimeFormat = real;
    setActiveLocale("en");
  });

  function phoneIs(tag: string) {
    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = () => ({ resolvedOptions: () => ({ locale: tag }) });
  }

  it("follows a Spanish-speaking phone", () => {
    phoneIs("es-MX");
    expect(phoneLocale()).toBe("es");
    setActiveLocale(phoneLocale());
    expect(tActive("nav.alerts")).toBe("Alertas");
  });

  it("is English otherwise", () => {
    phoneIs("fr-FR");
    expect(phoneLocale()).toBe("en");
  });
});
