import puppeteer, { type Browser } from "puppeteer";

let browserPromise: Promise<Browser> | null = null;

/** Max simultaneously open pages in the shared browser (concurrent jobs each hold one page; extras wait). */
export const MAX_OPEN_PAGES = 3;
let openPages = 0;
const pageWaiters: Array<() => void> = [];
async function acquirePageSlot(): Promise<void> {
  if (openPages < MAX_OPEN_PAGES) {
    openPages++;
    return;
  }
  await new Promise<void>((resolve) => pageWaiters.push(resolve));
}
function releasePageSlot(): void {
  const next = pageWaiters.shift();
  if (next) next(); // slot handed over directly
  else openPages = Math.max(0, openPages - 1);
}

/**
 * One Chromium instance shared across every PDF-rendering job in this worker process, instead of
 * each job launching (and tearing down) its own — Chromium cold-start is ~1-2s of pure overhead
 * paid on every single job, confirmed as a real, unconditional cost in a 2026-09-23 performance
 * audit (9 separate render*.ts files each called puppeteer.launch() independently). Callers open
 * their own `page` per job and close only that page in their own `finally` — never the shared
 * `browser` itself. The browser is closed once, on worker shutdown (see closeSharedBrowser, wired
 * into index.ts's SIGTERM/SIGINT handlers).
 *
 * executablePath override is opt-in via env var only — Railway's deployment gets Puppeteer's own
 * downloaded Chrome (root package.json's pnpm.onlyBuiltDependencies lets its postinstall script
 * actually run; pnpm 10 silently skips it otherwise) plus the shared libraries Chrome needs to
 * launch on Linux at all (root nixpacks.toml's aptPkgs) and needs no override; this exists purely
 * so local dev on a machine without a working Puppeteer Chrome install can still exercise the
 * pipeline by pointing at a system Chrome/Chromium instead.
 */
export function getSharedBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const launched: Promise<Browser> = puppeteer
      .launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
      })
      .then((browser) => {
        // Page-per-job with a bounded number of open pages: newPage waits for a slot, and the slot is
        // released when the page closes (callers close in finally) or the browser dies.
        const rawNewPage = browser.newPage.bind(browser);
        (browser as { newPage: typeof browser.newPage }).newPage = async () => {
          await acquirePageSlot();
          try {
            const page = await rawNewPage();
            let released = false;
            const release = () => {
              if (!released) {
                released = true;
                releasePageSlot();
              }
            };
            page.once("close", release);
            return page;
          } catch (err) {
            releasePageSlot();
            throw err;
          }
        };
        // A crashed Chromium must not poison later jobs: drop the cached promise so the next call relaunches.
        browser.on("disconnected", () => {
          if (browserPromise && browserPromise === launched) browserPromise = null;
        });
        return browser;
      })
      .catch((err) => {
        // Launch failed — clear the cached promise so the NEXT call retries a fresh launch instead
        // of permanently returning the same rejected promise for the rest of the process lifetime.
        browserPromise = null;
        throw err;
      });
    browserPromise = launched;
  }
  return browserPromise;
}

/** Closes the shared browser, if one was ever launched. Best-effort — called on worker shutdown. */
export async function closeSharedBrowser(): Promise<void> {
  if (!browserPromise) return;
  const current = browserPromise;
  browserPromise = null;
  try {
    const browser = await current;
    await browser.close();
  } catch {
    // Best-effort on shutdown — nothing left to report to.
  }
}
