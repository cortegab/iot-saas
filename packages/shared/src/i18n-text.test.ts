import { afterEach, describe, expect, it } from "vitest";
import { setActiveLocale } from "./i18n";
import { actionsText, conditionText, RULE_STATE, triggerText } from "./rule-text";
import { DEVICE_STATUS } from "./device-status";
import { healthLabel } from "./device-health";
import { commandStatusLabel, manualSender } from "./command-status";
import { ROLE_LABEL } from "./permissions";
import { signalWords } from "./signal";
import { timeAgo } from "./time-ago";
import { cronHuman } from "./schedule";
import { words } from "./simple-words";

// The shared wording in Spanish (DESIGN.md §11a): the same helpers, the
// language on screen set once by the app.
describe("shared wording in Spanish", () => {
  afterEach(() => setActiveLocale("en"));

  it("statuses, roles and health", () => {
    setActiveLocale("es");
    expect(DEVICE_STATUS.offline.label).toBe("Sin conexión");
    expect(RULE_STATE.stale.label).toBe("No se puede evaluar");
    expect(ROLE_LABEL.viewer).toBe("Lector");
    expect(healthLabel("faults", { faults: ["a", "b"] })).toBe("2 sensores no responden");
    expect(commandStatusLabel("confirmed")).toBe("Confirmado");
    expect(manualSender({ requested_by: null }, [], null)).toBe("manualmente");
    expect(signalWords(-65)).toBe("Buena");
    setActiveLocale("en");
    expect(DEVICE_STATUS.offline.label).toBe("Offline");
  });

  it("rule sentences", () => {
    setActiveLocale("es");
    const leaf = (metric: string, operator: string, value: number) =>
      ({ kind: "leaf", device_id: "d", metric, operator, rhs: { source: "static", value } }) as never;
    expect(conditionText({ kind: "group", op: "AND", predicates: [leaf("temp", ">", 27), leaf("hum", "<", 40)] } as never)).toBe("temp > 27 y hum < 40");
    expect(actionsText([{ type: "actuator_command", actuator: "fan1", value: true }])).toBe("Encender fan1");
    expect(actionsText([{ type: "email", to: ["a@b.c", "d@e.f"] }])).toBe("Correo a 2 personas");
    expect(triggerText({ trigger: { type: "manual" }, condition: null, devices: [] } as never)).toBe("Ejecución manual");
  });

  it("times and schedules", () => {
    setActiveLocale("es");
    const now = Date.parse("2026-11-25T12:00:00Z");
    expect(timeAgo("2026-11-25T11:48:00Z", now)).toBe("hace 12 min");
    expect(timeAgo(null)).toBe("nunca");
    expect(cronHuman("0 22 * * *")).toBe("todos los días a las 22:00");
    expect(cronHuman("30 7 * * 2,4")).toBe("mar, jue a las 07:30");
    expect(cronHuman("0 9 1 * *")).toBe("el día 1 de cada mes a las 09:00");
  });

  it("Simple view's words", () => {
    setActiveLocale("es");
    expect(words(true).rule).toBe("automatización");
    expect(words(false).actuator).toBe("actuador");
  });
});
