import { ApiRequestError } from "@iodriven/shared/api-client";
import { isRejection, pickTenant, safeNext, signInError } from "./session";

const m = (tenant_id: string) => ({ tenant_id, tenant_name: tenant_id, tenant_slug: tenant_id, role: "admin" });

describe("pickTenant", () => {
  const memberships = [m("a"), m("b")];
  it("prefers the requested, then the remembered, then the first workspace", () => {
    expect(pickTenant(memberships, "b", "a")).toBe("b");
    expect(pickTenant(memberships, null, "b")).toBe("b");
    expect(pickTenant(memberships, null, null)).toBe("a");
  });
  it("ignores a workspace the person no longer belongs to", () => {
    expect(pickTenant(memberships, "gone", "gone")).toBe("a");
  });
  it("is null without memberships", () => {
    expect(pickTenant([], null, "a")).toBeNull();
  });
});

describe("refresh failures", () => {
  it("ends the session only when the API rejects the token", () => {
    expect(isRejection(new ApiRequestError(401, "x"))).toBe(true);
    expect(isRejection(new ApiRequestError(503, "x"))).toBe(false);
    expect(isRejection(new TypeError("Network request failed"))).toBe(false);
  });
});

describe("signInError", () => {
  it("says what's wrong and what to do", () => {
    expect(signInError(new ApiRequestError(401, "Invalid email or password"))).toMatch(/don't match/);
    expect(signInError(new ApiRequestError(502, "Bad Gateway"))).toMatch(/Try again in a moment/);
    expect(signInError(new TypeError("Network request failed"))).toMatch(/Check your connection/);
  });
});

describe("safeNext", () => {
  it("keeps an in-app path and drops anything else", () => {
    expect(safeNext("/devices/abc")).toBe("/devices/abc");
    expect(safeNext("//evil.example")).toBeNull();
    expect(safeNext("https://evil.example")).toBeNull();
    expect(safeNext(undefined)).toBeNull();
  });
});
