/** The API client both apps use: JSON requests to the FastAPI backend with
 * the session's bearer token and workspace header, and FastAPI's errors
 * turned into readable messages. Context-free: the caller supplies the base
 * URL, `fetch` and, per call, the token and workspace. */
import type { paths } from "./api";

export type { paths as ApiPaths };

/** The slice of `fetch` this client uses, so this package needs neither the
 * DOM library nor React Native's types (the web and the app pass their own). */
export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<FetchResponse>;

/** Per-call auth context. */
export interface ApiClientContext {
  accessToken?: string | null;
  tenantId?: string | null;
}

export class ApiRequestError extends Error {
  status: number;
  body?: unknown;
  /** FastAPI 422 validation errors keyed by dotted field path (without the
   * leading "body"), e.g. `{"metrics.0.key": "String should match pattern…"}`. */
  fieldErrors: Record<string, string>;

  constructor(status: number, message: string, body?: unknown, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.body = body;
    this.fieldErrors = fieldErrors;
  }
}

export type JsonBody = Record<string, unknown> | undefined;
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface ValidationIssue {
  loc?: (string | number)[];
  msg?: string;
}

function isValidationList(detail: unknown): detail is ValidationIssue[] {
  return Array.isArray(detail) && detail.every((d) => d && typeof d === "object" && "msg" in d);
}

/** Dotted path of a 422 `loc`, minus the leading "body"/"query". */
function locPath(loc: (string | number)[] | undefined): string {
  const parts = (loc ?? []).filter((p, i) => !(i === 0 && (p === "body" || p === "query" || p === "path")));
  return parts.join(".");
}

/** A readable message from FastAPI's `detail` — a string, or the 422 list,
 * which used to be dropped (users saw "Unprocessable Entity"). */
export function extractDetail(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("detail" in body)) return undefined;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (isValidationList(detail)) {
    return detail
      .map((d) => {
        const path = locPath(d.loc);
        const msg = (d.msg ?? "").replace(/^Value error, /, "");
        return path ? `${path}: ${msg}` : msg;
      })
      .join("; ");
  }
  return undefined;
}

export function extractFieldErrors(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object" || !("detail" in body)) return {};
  const detail = (body as { detail?: unknown }).detail;
  if (!isValidationList(detail)) return {};
  const out: Record<string, string> = {};
  for (const d of detail) {
    const path = locPath(d.loc);
    if (path && !(path in out)) out[path] = (d.msg ?? "").replace(/^Value error, /, "");
  }
  return out;
}

/** One page of a history feed and the feed's total (the API's X-Total-Count). */
export interface ApiPage<T> {
  items: T[];
  total: number;
}

export interface ApiClient {
  get<T>(path: string, ctx?: ApiClientContext): Promise<T>;
  getPage<T>(path: string, ctx?: ApiClientContext): Promise<ApiPage<T>>;
  post<T>(path: string, ctx?: ApiClientContext, body?: JsonBody): Promise<T>;
  patch<T>(path: string, ctx?: ApiClientContext, body?: JsonBody): Promise<T>;
  put<T>(path: string, ctx?: ApiClientContext, body?: JsonBody): Promise<T>;
  delete<T>(path: string, ctx?: ApiClientContext): Promise<T>;
}

/** Every screen's error state should originate from an ApiRequestError thrown
 * here, so "what failed" is consistent across screens and apps. */
export function createApiClient(baseUrl: string, fetchFn: FetchLike): ApiClient {
  async function send<T>(method: Method, path: string, ctx: ApiClientContext, body?: JsonBody) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (ctx.accessToken) headers["Authorization"] = `Bearer ${ctx.accessToken}`;
    if (ctx.tenantId) headers["X-Tenant-Id"] = ctx.tenantId;

    const res = await fetchFn(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 204) return { data: undefined as T, res };

    const text = await res.text();
    const data: unknown = text ? JSON.parse(text) : undefined;

    if (!res.ok) {
      throw new ApiRequestError(res.status, extractDetail(data) ?? res.statusText ?? "Request failed", data, extractFieldErrors(data));
    }
    return { data: data as T, res };
  }

  const request = async <T>(method: Method, path: string, ctx: ApiClientContext = {}, body?: JsonBody) =>
    (await send<T>(method, path, ctx, body)).data;

  return {
    get: (path, ctx) => request("GET", path, ctx),
    /** A GET of a paged history feed: the rows and X-Total-Count (backend app/paging.py). */
    getPage: async <T>(path: string, ctx: ApiClientContext = {}) => {
      const { data, res } = await send<T[]>("GET", path, ctx);
      const total = Number(res.headers.get("X-Total-Count"));
      return { items: data ?? [], total: Number.isFinite(total) ? total : (data ?? []).length };
    },
    post: (path, ctx, body) => request("POST", path, ctx, body),
    patch: (path, ctx, body) => request("PATCH", path, ctx, body),
    put: (path, ctx, body) => request("PUT", path, ctx, body),
    delete: (path, ctx) => request("DELETE", path, ctx),
  };
}
