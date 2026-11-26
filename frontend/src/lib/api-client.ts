import { createApiClient } from "@iodriven/shared/api-client";
import { currentLocale } from "@/lib/i18n";

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

// Accept-Language: the backend answers errors and messages in the language
// on screen (DESIGN.md §11a).
export const apiClient = createApiClient(API_URL, (url, init) =>
  fetch(url, { ...init, headers: { ...init.headers, "Accept-Language": currentLocale() } }),
);
