import { describe, expect, it } from "vitest";
import { capital, words } from "./simple-words";

describe("words", () => {
  it("keeps the integrator's terms in Full and plain ones in Simple", () => {
    expect(words(false).template).toBe("template");
    expect(words(true).template).toBe("device type");
    expect(words(true).rules).toBe("automations");
    expect(capital(words(true).zone)).toBe("Area");
  });
  it("has the same terms in both views", () => {
    expect(Object.keys(words(true)).sort()).toEqual(Object.keys(words(false)).sort());
  });
});
