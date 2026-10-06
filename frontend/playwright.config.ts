import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// dotenv's default `dotenv/config` only reads ".env"; point it at .env.test
// explicitly (see .env.test.example) for E2E_EMAIL/E2E_PASSWORD.
loadEnv({ path: ".env.test" });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
});
