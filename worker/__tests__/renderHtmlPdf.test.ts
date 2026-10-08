import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import puppeteer, { type Browser } from "puppeteer";
import { setHtmlContentAndSettle } from "../src/jobs/renderHtml";
import { withBidi } from "../src/jobs/bidi";
import { buildNcrPdfHtml } from "../src/jobs/ncrTemplate";
import { buildHandoverCertificateHtml } from "../src/jobs/handoverCertificateTemplate";

// Real-Chrome render test. Skipped automatically when no Chrome binary can be found. Point it at one with
// PUPPETEER_EXECUTABLE_PATH (or it falls back to /opt/pw-browsers/chromium*/chrome-linux/chrome).
function findChrome(): string | null {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env && fs.existsSync(env)) return env;
  try {
    const root = "/opt/pw-browsers";
    for (const dir of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d))) {
      const p = path.join(root, dir, "chrome-linux", "chrome");
      if (fs.existsSync(p)) return p;
    }
  } catch {
    // no pw-browsers dir
  }
  try {
    const p = puppeteer.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {
    // none
  }
  return null;
}

const chrome = findChrome();

async function pdfInfo(pdf: Buffer): Promise<{ pages: number; text: string }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, isEvalSupported: false }).promise;
  let text = "";
  for (let p = 1; p <= doc.numPages; p++) {
    text += (await (await doc.getPage(p)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ") + "\n";
  }
  const pages = doc.numPages;
  await doc.destroy();
  return { pages, text: text.replace(/\s+/g, " ") };
}

// 1x1 red PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

describe.skipIf(!chrome)("setHtmlContentAndSettle with real Chrome", () => {
  let browser: Browser;
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true, executablePath: chrome!, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    server = http.createServer((req, res) => {
      if (req.url?.startsWith("/slow.png")) {
        setTimeout(() => {
          res.writeHead(200, { "content-type": "image/png" });
          res.end(Buffer.from(PNG, "base64"));
        }, 700);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  async function render(html: string): Promise<Buffer> {
    const page = await browser.newPage();
    try {
      await setHtmlContentAndSettle(page, withBidi(html));
      return Buffer.from(await page.pdf({ format: "A4", printBackground: true }));
    } finally {
      await page.close();
    }
  }

  it("renders text and an inline image to a valid PDF", async () => {
    const pdf = await render(
      `<html><body><h1>Settle Check Heading</h1><p>Plain system-font paragraph</p><img width="40" height="40" src="data:image/png;base64,${PNG}"></body></html>`,
    );
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const info = await pdfInfo(pdf);
    expect(info.pages).toBeGreaterThanOrEqual(1);
    expect(info.text).toContain("Settle Check Heading");
    expect(info.text).toContain("Plain system-font paragraph");
  }, 60_000);

  it("waits for a slow network image before returning", async () => {
    const page = await browser.newPage();
    try {
      let finished = false;
      page.on("requestfinished", (r) => {
        if (r.url().includes("slow.png")) finished = true;
      });
      await setHtmlContentAndSettle(page, `<html><body><p>slow</p><img src="${base}/slow.png"></body></html>`);
      expect(finished).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("renders the NCR template", async () => {
    const pdf = await render(
      buildNcrPdfHtml({
        ncrNumber: "NCR-042",
        severity: "major_ncr",
        projectName: "P-1 Skid Package",
        organizationName: "Acme Fabrication",
        status: "closed",
        description: "Weld porosity found on seam W-12",
        requirementNotMet: "AWS D1.1 clause 6.9",
        evidence: "photo-1.jpg, photo-2.jpg",
        assigneeName: "Sam Welder",
        dueDate: "2026-10-20",
        rootCause: "Shielding gas flow too low",
        correctiveAction: "Re-weld and re-inspect",
        preventiveAction: "Add flow check to start-of-shift",
        verificationNotes: "Re-inspected OK",
        closedByName: "Oliver Bennett",
        closedAt: "2026-10-05T10:00:00Z",
        generatedAt: new Date("2026-10-07T10:00:00Z"),
        issueDate: "2026-09-30",
      }),
    );
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const info = await pdfInfo(pdf);
    expect(info.pages).toBeGreaterThanOrEqual(1);
    expect(info.text).toContain("NCR-042");
    expect(info.text).toContain("Weld porosity found on seam W-12");
    expect(info.text).toContain("Shielding gas flow too low");
  }, 60_000);

  it("renders the handover certificate template", async () => {
    const pdf = await render(
      buildHandoverCertificateHtml({
        certificateNumber: "HC-001",
        issuedDate: "2026-10-07",
        issuedByName: "Oliver Bennett",
        bookNumber: "DB-001",
        bookTitle: "Final Data Book",
        bookRevision: "1",
        projectName: "P-1 Skid",
        organizationName: "Acme",
        packageSha256: "ab".repeat(32),
        isConditional: false,
        conditionalReason: null,
        conditionalOpenItems: [],
        acknowledgedAt: null,
        receivedByName: null,
        receivedByCompany: null,
        acknowledgedOnBehalf: false,
        revision: "0",
        generatedAt: new Date("2026-10-07T10:00:00Z"),
      }),
    );
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const info = await pdfInfo(pdf);
    expect(info.pages).toBeGreaterThanOrEqual(1);
    expect(info.text).toContain("HC-001");
    expect(info.text).toContain("Final Data Book");
  }, 60_000);
});
