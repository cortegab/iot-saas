import { describe, expect, it } from "vitest";
import { ApiRequestError, createApiClient, type FetchLike } from "./api-client";

type Call = { url: string; init: Parameters<FetchLike>[1] };

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "Status",
      headers: { get: (name) => headers[name] ?? null },
      text: async () => (body === undefined ? "" : JSON.stringify(body)),
    };
  };
  return { fetchFn, calls };
}

describe("createApiClient", () => {
  it("sends JSON with the token and workspace", async () => {
    const { fetchFn, calls } = fakeFetch(200, { id: "d1" });
    const api = createApiClient("https://api.example", fetchFn);
    await expect(api.post("/devices", { accessToken: "t", tenantId: "w" }, { name: "bay1" })).resolves.toEqual({ id: "d1" });
    expect(calls[0].url).toBe("https://api.example/devices");
    expect(calls[0].init.headers).toMatchObject({ Authorization: "Bearer t", "X-Tenant-Id": "w" });
    expect(calls[0].init.body).toBe('{"name":"bay1"}');
  });

  it("resolves 204 to undefined", async () => {
    const { fetchFn } = fakeFetch(204, undefined);
    await expect(createApiClient("", fetchFn).delete("/x")).resolves.toBeUndefined();
  });

  it("reads a page's total from X-Total-Count", async () => {
    const { fetchFn } = fakeFetch(200, [1, 2], { "X-Total-Count": "40" });
    await expect(createApiClient("", fetchFn).getPage("/feed")).resolves.toEqual({ items: [1, 2], total: 40 });
  });

  it("turns FastAPI errors into readable messages and field errors", async () => {
    const { fetchFn } = fakeFetch(422, { detail: [{ loc: ["body", "metrics", 0, "key"], msg: "Value error, Bad key" }] });
    const err = await createApiClient("", fetchFn).post("/catalog").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).message).toBe("metrics.0.key: Bad key");
    expect((err as ApiRequestError).fieldErrors).toEqual({ "metrics.0.key": "Bad key" });
  });

  it("keeps a string detail as the message", async () => {
    const { fetchFn } = fakeFetch(401, { detail: "Invalid email or password" });
    await expect(createApiClient("", fetchFn).post("/auth/login")).rejects.toMatchObject({ status: 401, message: "Invalid email or password" });
  });
});
