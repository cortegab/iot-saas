import { createApiClient } from "@iodriven/shared/api-client";
import { currentLocale } from "@/i18n/I18nProvider";
import { apiUrl } from "./config";

/** The shared API client bound to this build's API and React Native's fetch. */
// Accept-Language: errors come back in the language on screen (DESIGN.md §11a).
export const api = createApiClient(apiUrl(), (url, init) =>
  fetch(url, { ...init, headers: { ...init.headers, "Accept-Language": currentLocale() } }),
);
