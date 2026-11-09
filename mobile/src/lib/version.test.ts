import { compareVersions, versionCode } from "./version";

describe("versions", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.5.0", "0.5.0")).toBe(0);
    expect(compareVersions("0.4.3", "0.5.0")).toBeLessThan(0);
  });

  it("never blocks on a version it can't read", () => {
    expect(compareVersions("dev", "1.0.0")).toBe(0);
  });

  it("gives Play an increasing versionCode", () => {
    expect(versionCode("0.5.0")).toBe(500);
    expect(versionCode("1.0.0")).toBeGreaterThan(versionCode("0.99.99"));
  });
});
