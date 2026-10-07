import type { Browser, BrowserContext, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { BASE_URL, PASSWORD, type RoleDef } from "./env";

const AUTH_DIR = path.join(__dirname, "..", ".auth");
/** A saved session older than this is discarded (the app also enforces its own session limits). */
const MAX_STATE_AGE_MS = 20 * 60_000;

export const statePath = (role: RoleDef) => path.join(AUTH_DIR, `${role.key}.json`);

function freshState(role: RoleDef): string | null {
  try {
    const file = statePath(role);
    const age = Date.now() - fs.statSync(file).mtimeMs;
    return age < MAX_STATE_AGE_MS ? file : null;
  } catch {
    return null;
  }
}

/**
 * Signs in through the real sign-in form (the only form this suite ever submits). Resolves once the
 * browser has left /login. Returns the pathname it landed on.
 */
export async function signInViaForm(page: Page, role: RoleDef, next?: string): Promise<string> {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.locator("#email").fill(role.email);
  await page.locator("#password").fill(PASSWORD);
  // After a successful sign-in the app redirects to "/" and "/" immediately redirects again to the
  // role's landing page, so wait for a path that is neither /login nor the bare root.
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login") && url.pathname !== "/", { timeout: 60_000 }),
    page.getByRole("button", { name: /^sign in/i }).click(),
  ]);
  await page.waitForLoadState("domcontentloaded");
  return new URL(page.url()).pathname;
}

export function saveState(context: BrowserContext, role: RoleDef): Promise<unknown> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  return context.storageState({ path: statePath(role) });
}

/**
 * A browser context already signed in as `role`. Reuses a recent saved session when there is one
 * (so the suite performs roughly one real sign-in per role per run), otherwise signs in through the
 * form and saves the session for the next spec. Callers must close the returned context.
 */
export async function contextAs(browser: Browser, role: RoleDef): Promise<BrowserContext> {
  const saved = freshState(role);
  if (saved) {
    const context = await browser.newContext({ baseURL: BASE_URL, storageState: saved });
    // Cheap validity probe: a dead session bounces to /login.
    const probe = await context.newPage();
    await probe.goto("/inspect", { waitUntil: "domcontentloaded" });
    const alive = !new URL(probe.url()).pathname.startsWith("/login");
    await probe.close();
    if (alive) return context;
    await context.close();
  }
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await signInViaForm(page, role);
  await saveState(context, role);
  await page.close();
  return context;
}

/** Visible text that means a page rendered an error state instead of content. */
export const ERROR_TEXT =
  /Something went wrong|Application error|Internal Server Error|This page could not be found|Page not found|could not load this page|Unhandled Runtime Error|Error ID:/i;

export interface PageProbe {
  status: number | null;
  finalPath: string;
  title: string;
  heading: string;
  errorText: string | null;
  consoleErrors: string[];
}

/**
 * Opens `target` and reports how it rendered. Never throws on an app error — the caller asserts —
 * so one broken page produces one clear failure instead of aborting a whole role's walk.
 */
export async function probePage(page: Page, target: string): Promise<PageProbe> {
  const consoleErrors: string[] = [];
  const onConsole = (msg: { type(): string; text(): string }) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  };
  page.on("console", onConsole);
  try {
    const response = await page.goto(target, { waitUntil: "domcontentloaded" });
    // Server-rendered pages stream; give the shell + content a moment to settle without waiting for
    // never-idle background requests (Sentry, service worker, polling).
    await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => undefined);
    await page.locator("main, h1, [role=alert]").first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    const body = (await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "")) ?? "";
    const match = body.match(ERROR_TEXT);
    const heading = (await page.locator("h1").first().innerText({ timeout: 2_000 }).catch(() => "")).trim();
    return {
      status: response?.status() ?? null,
      finalPath: new URL(page.url()).pathname + new URL(page.url()).search,
      title: await page.title(),
      heading,
      errorText: match ? match[0] : null,
      consoleErrors,
    };
  } finally {
    page.off("console", onConsole);
  }
}
