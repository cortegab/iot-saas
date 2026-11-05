import { createApiClient } from "@iodriven/shared/api-client";

// The client lives in packages/shared (shared with the mobile app); the web
// binds it to its API URL and the browser's fetch.
export {
  ApiRequestError,
  extractDetail,
  extractFieldErrors,
  type ApiClientContext,
  type ApiPage,
  type ApiPaths,
} from "@iodriven/shared/api-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const apiClient = createApiClient(API_URL, (url, init) => fetch(url, init));
