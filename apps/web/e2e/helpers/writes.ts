import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/**
 * Shared plumbing for the GATED WRITE specs (tests/05-*.spec.ts).
 *
 * The rest of the suite is read-only. The 05-* specs create, change and close real records on the
 * deployed site, so they are SKIPPED unless E2E_ALLOW_WRITES=1, and everything they create lives in an
 * organisation and projects whose names start with `E2E-` (so scripts/cleanup-e2e-data.mjs can find
 * exactly those and nothing else).
 *
 * Environment (see e2e/README.md):
 *   E2E_ALLOW_WRITES=1                    arm the write specs (anything else = they are skipped)
 *   E2E_SUPABASE_URL                      the Supabase project behind BASE_URL (used ONLY to seed the
 *   E2E_SUPABASE_SERVICE_ROLE_KEY         E2E- fixtures and to read back what the UI wrote). Never a fallback to
 *                                         the app's own env: the suite must be pointed at a project on purpose.
 *   E2E_RUN_TAG                           optional; default is generated once per run
 */
export const WRITES_ENABLED = process.env.E2E_ALLOW_WRITES === "1";
export const WRITES_SKIP_REASON = "write specs are skipped unless E2E_ALLOW_WRITES=1 (they create real records on the site under test)";
export const E2E_PREFIX = "E2E-";

const STATE_DIR = path.join(__dirname, "..", ".state");
const STATE_FILE = path.join(STATE_DIR, "write-run.json");

/** What the setup spec created; later specs read it. Everything here carries the run tag in its name. */
export interface WriteFixture {
  runTag: string;
  organizationId: string;
  organizationName: string;
  /** Project the NCR / punch / inspection / IRN specs work in (active). */
  projectId: string;
  projectNumber: string;
  projectName: string;
  /** Project the Data Book / handover specs work in (completed, nothing open). */
  handoverProjectId: string;
  handoverProjectName: string;
  itpId: string;
  itemId: string;
  checklistTemplateId: string;
  locationPreset: string;
  /** Filled in by later specs as they create records. */
  inspectionRecordId?: string;
  irnNumber?: string;
  dataBookId?: string;
  dataBookNumber?: string;
  certificateId?: string;
  certificateNumber?: string;
}

/** `E2E-<tag>`: the prefix of every name the suite creates. */
export function newRunTag(): string {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(2, 12); // yymmddhhmm
  return `${E2E_PREFIX}${stamp}${Math.random().toString(36).slice(2, 6)}`;
}

export function readFixture(): WriteFixture {
  if (!fs.existsSync(STATE_FILE)) {
    throw new Error("No write fixture found: run tests/05-00-write-setup.spec.ts first (it seeds the E2E- organisation and projects).");
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as WriteFixture;
}

export function saveFixture(fixture: WriteFixture): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(fixture, null, 2));
}

export function updateFixture(patch: Partial<WriteFixture>): WriteFixture {
  const next = { ...readFixture(), ...patch };
  saveFixture(next);
  return next;
}

/** A name for a record the UI creates, always starting with the run tag (and so with `E2E-`). */
export const e2eName = (fixture: Pick<WriteFixture, "runTag">, what: string) => `${fixture.runTag} ${what}`;

let cachedDb: SupabaseClient | null = null;

/** Service-role client for the Supabase project behind the site under test. Seeds fixtures and reads back results; the UI does the writes under test. */
export function serviceDb(): SupabaseClient {
  if (cachedDb) return cachedDb;
  const url = process.env.E2E_SUPABASE_URL?.trim();
  const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY are required by the write specs (to seed the E2E- fixtures and to read back what the UI wrote).");
  }
  cachedDb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return cachedDb;
}

/**
 * Refuses to continue unless the page shows the run tag, i.e. the browser really is on an E2E- record.
 * Called before every submit so a mis-resolved link can never write to a demo project.
 */
export async function expectE2eContext(page: Page, fixture: Pick<WriteFixture, "runTag">): Promise<void> {
  await expect(page.locator("body"), `expected the page to show the ${fixture.runTag} fixture before writing`).toContainText(fixture.runTag, { timeout: 20_000 });
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A valid 1x1 PNG (built, not pasted, so its CRCs are right), for the photo-evidence inputs. */
export const TINY_PNG = (() => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const raw = Buffer.from([0, 200, 30, 30]); // filter byte + one RGB pixel
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
})();

export const evidencePng = (name = "e2e-evidence.png") => ({ name, mimeType: "image/png", buffer: TINY_PNG });

/** Draws a short stroke on the first (or nth) signature canvas on the page. */
export async function drawSignature(page: Page, index = 0): Promise<void> {
  const canvas = page.locator("canvas").nth(index);
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("signature canvas is not visible");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.2, { steps: 6 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7, { steps: 6 });
  await page.mouse.up();
}
