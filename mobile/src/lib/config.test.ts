import { apiUrl, webUrl } from "./config";

describe("apiUrl", () => {
  it("drops trailing slashes", () => {
    expect(apiUrl("https://api.iodriven.tech/")).toBe("https://api.iodriven.tech");
    expect(apiUrl(" http://localhost:8000 ")).toBe("http://localhost:8000");
  });
  it("says what to set when it's missing or wrong", () => {
    expect(() => apiUrl("")).toThrow(/mobile\/\.env/);
    expect(() => apiUrl("api.iodriven.tech")).toThrow(/http\(s\)/);
  });
});

describe("webUrl", () => {
  it("drops the api. subdomain in production", () => {
    expect(webUrl("https://api.iodriven.tech", undefined)).toBe("https://iodriven.tech");
  });
  it("points a local API at the local web app", () => {
    expect(webUrl("http://localhost:8000", undefined)).toBe("http://localhost:3000");
  });
  it("prefers EXPO_PUBLIC_WEB_URL", () => {
    expect(webUrl("https://api.iodriven.tech", "https://app.example.com/")).toBe("https://app.example.com");
  });
});
