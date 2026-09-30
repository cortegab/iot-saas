import type { paths } from "@/types/api";

export type { paths as ApiPaths };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Per-call auth context. Kept explicit (not a module-level singleton) so this file
 * has no dependency on React or on how the caller stores tokens — auth-context.tsx
 * (Stage 2) supplies these from React state. */
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

type JsonBody = Record<string, unknown> | undefined;

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

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  ctx: ApiClientContext,
  body?: JsonBody,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ctx.accessToken) headers["Authorization"] = `Bearer ${ctx.accessToken}`;
  if (ctx.tenantId) headers["X-Tenant-Id"] = ctx.tenantId;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      extractDetail(data) ?? res.statusText ?? "Request failed",
      data,
      extractFieldErrors(data),
    );
  }

  return data as T;
}

/** Every screen's error state should originate from an ApiRequestError caught here,
 * so "what failed" (UX_UI_Description.md's Error state) is consistent across screens. */
export const apiClient = {
  get: <T>(path: string, ctx: ApiClientContext = {}) => request<T>("GET", path, ctx),
  post: <T>(path: string, ctx: ApiClientContext = {}, body?: JsonBody) => request<T>("POST", path, ctx, body),
  patch: <T>(path: string, ctx: ApiClientContext = {}, body?: JsonBody) => request<T>("PATCH", path, ctx, body),
  delete: <T>(path: string, ctx: ApiClientContext = {}) => request<T>("DELETE", path, ctx),
};
