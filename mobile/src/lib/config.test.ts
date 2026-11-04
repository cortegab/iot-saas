import { apiUrl } from "./config";

describe("apiUrl", () => {
  it("drops trailing slashes", () => {
    expect(apiUrl("https://api.iodriven.tech/")).toBe("https://api.iodriven.tech");
    expect(apiUrl(" http://localhost:8000 ")).toBe("http://localhost:8000");
  });
  it("says what to set when it's missing or wrong", () => {
    expect(() => apiUrl(undefined)).toThrow(/mobile\/\.env/);
    expect(() => apiUrl("api.iodriven.tech")).toThrow(/http\(s\)/);
  });
});
