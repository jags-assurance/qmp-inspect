import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Read-only end-to-end suite for the deployed QMP web app (see e2e/README.md and
 * docs/E2E_RUN_RESULTS.md). It signs in with the seeded demo accounts and only ever navigates and
 * reads: no form is submitted other than the sign-in form, and no server action is invoked.
 *
 * Configuration (all via environment):
 *   BASE_URL            Site under test. Default https://jags-qmp-client-dev.vercel.app
 *   E2E_PASSWORD        Shared demo password. Default DemoPass123!
 *   E2E_<ROLE>_EMAIL    Override one demo login (see helpers/env.ts for the role keys).
 *   PLAYWRIGHT_BROWSERS_PATH
 *                       When set (e.g. /opt/pw-browsers) and it holds a `chromium` launcher, that
 *                       binary is used via executablePath. Never run `playwright install` here.
 */
// `||` (not `??`): CI passes unset secrets through as empty strings, which must fall back too.
const BASE_URL = (process.env.BASE_URL?.trim() || "https://jags-qmp-client-dev.vercel.app").replace(/\/+$/, "");

function chromiumExecutable(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root) return undefined;
  const candidate = path.join(root, "chromium");
  return fs.existsSync(candidate) ? candidate : undefined;
}

const executablePath = chromiumExecutable();

export default defineConfig({
  testDir: path.join(__dirname, "tests"),
  outputDir: path.join(__dirname, "test-results"),
  // Specs run in file-name order (01-login first). One worker keeps the load on the shared dev site
  // and the sign-in throttle gentle; sessions are cached per role under e2e/.auth.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(__dirname, "test-results", "results.json") }],
    ["html", { open: "never", outputFolder: path.join(__dirname, "playwright-report") }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    launchOptions: executablePath
      ? { executablePath, args: ["--no-sandbox"] }
      : { args: process.env.CI ? ["--no-sandbox"] : [] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
