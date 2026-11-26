import { afterEach, describe, expect, it } from "vitest";
import { setActiveLocale } from "./i18n";
import { notificationText } from "./notification-text";

describe("notificationText", () => {
  afterEach(() => setActiveLocale("en"));
  const fired = {
    message: "temp goes above 30 (currently 31.5).",
    i18n: {
      message: {
        key: "rule.fired",
        params: { condition: { kind: "leaf", metric: "temp", operator: ">", rhs: { source: "static", value: 30 }, current: 31.5 } },
      },
    },
  };

  it("words the platform's notifications in the language on screen", () => {
    expect(notificationText(fired).message).toBe("temp goes above 30 (currently 31.5).");
    setActiveLocale("es");
    expect(notificationText(fired).message).toBe("temp supera 30 (ahora 31.5).");
    const offline = { message: "pump went offline", detail: "x", i18n: { message: { key: "device.offline", params: { device: "pump" } }, detail: { key: "device.offlineDetail", params: {} } } };
    expect(notificationText(offline)).toEqual({ message: "pump se desconectó", detail: "Llegó su last will: la conexión se cortó sin despedirse." });
  });

  it("keeps a person's own message and older rows as written", () => {
    setActiveLocale("es");
    expect(notificationText({ message: "Check the pump", i18n: null }).message).toBe("Check the pump");
    expect(notificationText({ message: "Old row", detail: "d" })).toEqual({ message: "Old row", detail: "d" });
    expect(notificationText({ message: "Unknown", i18n: { message: { key: "nope.nope", params: {} } } }).message).toBe("Unknown");
  });

  it("words groups with the language's and / or", () => {
    setActiveLocale("es");
    const n = {
      message: "",
      i18n: {
        message: {
          key: "rule.cleared",
          params: {
            condition: {
              kind: "group",
              op: "AND",
              predicates: [
                { kind: "leaf", metric: "a", operator: "between", rhs: { source: "range", low: 1, high: 2 }, current: null },
                { kind: "leaf", metric: "b", operator: "changed", rhs: null, current: 3 },
              ],
            },
          },
        },
      },
    };
    expect(notificationText(n).message).toBe("Liberada: a entra entre 1 y 2 y b cambia (ahora 3).");
  });
});
