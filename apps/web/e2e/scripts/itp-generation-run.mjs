// Live check of playbook steps A2, A4, B1 and B2 on the DEV deployment: creates the "Test Harbour
// Power" organisation and project THP-2026-001 (skipped if they already exist), uploads the sample
// documents from docs/sample-itp-sources into the project's Document Vault, runs "Generate draft"
// and scores the draft with docs/sample-itp-sources/verify-draft.mjs.
//
//   ITP_RUN_CONFIRM=1 node e2e/scripts/itp-generation-run.mjs
//
// It WRITES to the site under test (org, project, vault documents, one AI call). It never creates
// the ITP itself. Refuses to run against the live address.
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLES = join(here, "../../../../docs/sample-itp-sources");
const OUT = join(here, "../.state/itp-generation");
const BASE = (process.env.BASE_URL || "https://jags-qmp-client-dev.vercel.app").replace(/\/+$/, "");
const EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@jagsassurance.local";
const PASSWORD = process.env.E2E_PASSWORD || "DemoPass123!";
const ORG = process.env.ITP_RUN_ORG || "Test Harbour Power";
const PROJECT_NO = process.env.ITP_RUN_PROJECT || "THP-2026-001";
const DEPTH = process.env.ITP_RUN_DEPTH || "Standard";

if (process.env.ITP_RUN_CONFIRM !== "1") {
  console.error("Writes to the site under test. Set ITP_RUN_CONFIRM=1 to run.");
  process.exit(2);
}
if (/jags-qmp-client\.vercel\.app/.test(BASE)) {
  console.error("Refusing to run against the live address.");
  process.exit(2);
}

const UPLOADS = [
  { folder: "Specifications", file: "THP-SPEC-E-001_RevA_LV_Switchroom_Specification.docx", title: "LV Switchroom Specification", ref: "THP-SPEC-E-001" },
  { folder: "Standards & Codes", file: "THP-ES-200_Rev1_Client_Electrical_Standard.pdf", title: "Client Electrical Installation Standard", ref: "THP-ES-200" },
  { folder: "Method Statements", file: "THP-MS-E-003_RevA_Method_Statement.docx", title: "Method Statement LV Switchboard", ref: "THP-MS-E-003" },
  { folder: "Drawings", file: "THP-DWG-E-101_RevA_SLD_and_Cable_Schedule.pdf", title: "SLD and Cable Schedule", ref: "THP-DWG-E-101" },
  { folder: "Material Submittals", file: "THP-MAT-E-002_RevA_Material_Submittal_Schedule.txt", title: "Material Submittal Schedule", ref: "THP-MAT-E-002" },
];

mkdirSync(OUT, { recursive: true });
const log = [];
const step = (id, status, note = "") => {
  log.push({ id, status, note });
  console.log(`${status.padEnd(6)} ${id} ${note}`);
};

const executablePath = existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.setDefaultTimeout(30_000);
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });

try {
  // A1 - sign in
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 }), page.click('button[type="submit"]')]);
  step("A1", "PASS", `signed in, landed on ${new URL(page.url()).pathname}`);

  // A2 - client organisation
  await page.goto(`${BASE}/inspect/organisation/clients`, { waitUntil: "load" });
  if (await page.getByText(ORG, { exact: true }).count()) {
    step("A2", "SKIP", `"${ORG}" already exists`);
  } else {
    await page.locator('input[name="name"]').fill(ORG);
    await page.locator('input[name="engagement_scope"][value="full_service"]').check();
    await page.getByRole("button", { name: /Create organisation/i }).click();
    await page.getByText(ORG, { exact: true }).first().waitFor({ timeout: 30_000 });
    step("A2", "PASS", `"${ORG}" created`);
  }
  await shot("A2-organisations");

  // A2 (optional) - AI consent, required for the project to appear in "Generate from vault documents"
  // Each organisation card has one consent form; find the form whose own card names ORG.
  const formIndex = await page.locator("form").evaluateAll((forms, org) => {
    const consent = forms.filter((f) => f.querySelector('input[name="enable"]'));
    return consent.findIndex((f) => {
      let el = f.parentElement;
      while (el && el.querySelectorAll('input[name="enable"]').length === 1) {
        if (el.textContent.includes(org)) return true;
        el = el.parentElement;
      }
      return false;
    });
  }, ORG);
  const consentForm = page.locator("form").filter({ has: page.locator('input[name="enable"]') }).nth(formIndex);
  if ((await consentForm.locator('input[name="enable"]').inputValue()) === "false") {
    step("A2 consent", "SKIP", "AI consent already given");
  } else {
    const slug = (await consentForm.locator("label").innerText()).match(/[“"](.+?)[”"]/)[1];
    await consentForm.locator('input[name="confirm"]').fill(slug);
    await consentForm.getByRole("button", { name: /Give AI consent/ }).click();
    await consentForm.getByRole("button", { name: /Withdraw AI consent/ }).waitFor({ timeout: 30_000 });
    step("A2 consent", "PASS", `AI consent given (typed "${slug}")`);
  }

  // A4 - project
  await page.goto(`${BASE}/inspect/projects`, { waitUntil: "load" });
  let projectLink = page.locator("a", { hasText: PROJECT_NO }).first();
  if (await projectLink.count()) {
    step("A4", "SKIP", `${PROJECT_NO} already exists`);
  } else {
    await page.goto(`${BASE}/inspect/projects/new`, { waitUntil: "load" });
    await page.locator('select[name="organization_id"]').selectOption({ label: ORG });
    await page.locator('input[name="project_number"]').fill(PROJECT_NO);
    await page.locator('input[name="name"]').fill("Switchroom Electrical Fit-out");
    await page.locator('input[name="site_location"]').fill("Harbour Site, Building 4");
    await page.getByRole("button", { name: /Create project/i }).click();
    await page.waitForURL((u) => /\/inspect\/projects\/[0-9a-f-]{36}/.test(u.pathname) || u.pathname === "/inspect/projects", { timeout: 60_000 });
    step("A4", "PASS", `${PROJECT_NO} created`);
    await page.goto(`${BASE}/inspect/projects`, { waitUntil: "load" });
    projectLink = page.locator("a", { hasText: PROJECT_NO }).first();
  }
  const projectHref = await projectLink.getAttribute("href");
  const projectId = projectHref.match(/[0-9a-f-]{36}/)[0];

  // B1 - vault uploads
  await page.goto(`${BASE}/inspect/vault?project=${projectId}`, { waitUntil: "load" });
  await shot("B1-vault-folders");
  const folderCount = await page.locator(`a[href^="/inspect/vault/${projectId}/"]`).count();
  step("A4/B1", folderCount >= 12 ? "PASS" : "FAIL", `${folderCount} vault folder links (expect >= 12)`);

  for (const u of UPLOADS) {
    await page.goto(`${BASE}/inspect/vault?project=${projectId}`, { waitUntil: "load" });
    await page.locator(`a[href^="/inspect/vault/${projectId}/"]`, { hasText: u.folder }).first().click();
    await page.waitForLoadState("load");
    if ((await page.locator("main").innerText()).includes(u.ref)) {
      step(`B1 ${u.ref}`, "SKIP", "already uploaded");
      continue;
    }
    await page.locator('input#file[name="file"]').setInputFiles(join(SAMPLES, u.file));
    await page.locator('input[name="title"]').fill(u.title);
    await page.locator('input[name="document_reference"]').fill(u.ref);
    await page.locator('input[name="revision"]').fill("A");
    await page.locator("#vault-upload").getByRole("button", { name: /^Upload/ }).click();
    const ok = await page.getByText(/Uploaded\. Assigned document number/).first().waitFor({ timeout: 90_000 }).then(() => true, () => false);
    const number = ok ? (await page.getByText(/Uploaded\. Assigned document number/).first().innerText()).match(/number: (\S+?)\./)?.[1] : "";
    step(`B1 ${u.ref}`, ok ? "PASS" : "FAIL", `${u.file} -> ${u.folder} ${number ?? ""}`);
    if (!ok) await shot(`B1-fail-${u.ref}`);
  }

  // B1 negative - a script must be refused
  await page.goto(`${BASE}/inspect/vault?project=${projectId}`, { waitUntil: "load" });
  await page.locator(`a[href^="/inspect/vault/${projectId}/"]`, { hasText: "General Reference" }).first().click();
  await page.waitForLoadState("load");
  await page.locator('input#file[name="file"]').setInputFiles(join(SAMPLES, "negative-tests/refuse-me.sh"));
  await page.waitForTimeout(1500);
  const uploadBtn = page.locator("#vault-upload").getByRole("button", { name: /^Upload/ });
  if (await uploadBtn.isEnabled()) {
    await page.locator('input[name="title"]').fill("Refuse me").catch(() => {});
    await uploadBtn.click();
  }
  const refused = await page.getByText(/Executable\/script files can't be stored in the vault/).first().waitFor({ timeout: 20_000 }).then(() => true, () => false);
  step("B1 script refused", refused ? "PASS" : "FAIL", refused ? "refusal message shown" : "no refusal message seen");
  await shot("B1-script-refused");

  // B2 - generate the draft
  await page.goto(`${BASE}/inspect/itps/new`, { waitUntil: "load" });
  await page.getByText(/Generate from vault documents/i).first().click();
  const projectSelect = page.locator("select").filter({ has: page.locator(`option:has-text("${PROJECT_NO}")`) }).first();
  await projectSelect.selectOption(projectId);
  // Extraction runs at upload; give it time to show "Ready" (done) for every document.
  let usable = 0;
  for (let i = 0; i < 12; i++) {
    usable = await page.locator('input[name="vault_document_ids"]:not([disabled])').count();
    if (usable >= UPLOADS.length) break;
    await page.waitForTimeout(5000);
    await page.reload({ waitUntil: "load" });
    await page.getByText(/Generate from vault documents/i).first().click();
    await projectSelect.selectOption(projectId);
  }
  step("B1 extraction", usable >= UPLOADS.length ? "PASS" : "FAIL", `${usable}/${UPLOADS.length} documents usable for AI`);
  for (const cb of await page.locator('input[name="vault_document_ids"]:not([disabled])').all()) await cb.check();
  await page.getByText(DEPTH, { exact: true }).first().click().catch(() => {});
  await shot("B2-form");
  await page.getByRole("button", { name: /Generate draft/i }).click();

  const draftField = page.locator('input[name="draft_json"]');
  const outcome = await Promise.race([
    draftField.waitFor({ state: "attached", timeout: 300_000 }).then(() => "draft"),
    page.getByText(/AI assistance is not available|not available in this environment|Could not generate|consent/i).first().waitFor({ timeout: 300_000 }).then(() => "message"),
  ]).catch(() => "timeout");
  await shot("B2-result");

  if (outcome === "draft") {
    const draft = JSON.parse(await draftField.inputValue());
    writeFileSync(join(OUT, "draft.json"), JSON.stringify(draft, null, 2));
    const { verifyDraft } = await import(join(SAMPLES, "verify-draft.mjs"));
    const r = verifyDraft(draft);
    writeFileSync(join(OUT, "verify.json"), JSON.stringify(r, null, 2));
    step("B2", "PASS", `draft with ${r.sectionCount} sections / ${r.itemCount} activities`);
    step("B2 quality", r.pass ? "PASS" : "FAIL", `coverage ${Math.round(r.coverage * 100)}%, accuracy ${Math.round(r.accuracy * 100)}%, issues ${r.issues.length}`);
  } else if (outcome === "message") {
    const msg = await page.getByText(/AI assistance is not available|not available in this environment|Could not generate|consent/i).first().innerText();
    step("B2", "AI-OFF", msg.slice(0, 200));
  } else {
    step("B2", "FAIL", "no draft and no message within 5 minutes");
  }
} catch (err) {
  step("ERROR", "FAIL", err.message.split("\n")[0]);
  await shot("error").catch(() => {});
} finally {
  writeFileSync(join(OUT, "steps.json"), JSON.stringify(log, null, 2));
  await browser.close();
}
