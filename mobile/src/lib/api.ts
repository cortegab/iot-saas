import { createApiClient } from "@iodriven/shared/api-client";
import { apiUrl } from "./config";

/** The shared API client bound to this build's API and React Native's fetch. */
export const api = createApiClient(apiUrl(), (url, init) => fetch(url, init));
