import { describe, expect, it } from "vitest";
import { signalLabel, signalWords } from "./signal";

describe("signalWords", () => {
  it("names the band", () => {
    expect(signalWords(-50)).toBe("Strong");
    expect(signalWords(-60)).toBe("Strong");
    expect(signalWords(-63)).toBe("Good");
    expect(signalWords(-75)).toBe("Weak");
    expect(signalWords(-88)).toBe("Very weak");
  });
  it("keeps the dBm alongside", () => {
    expect(signalLabel(-63)).toBe("Good (-63 dBm)");
  });
});
