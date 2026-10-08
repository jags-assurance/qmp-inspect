import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { contextAs, probePage, type PageProbe } from "../helpers/auth";
import { ROLES } from "../helpers/env";
import { appHrefs, uuidPath, watchForMutations } from "../helpers/readonly";

/**
 * Read-only walk through the QA chain for every role:
 *   project -> ITP -> checklist -> inspection -> NCR -> vault -> handover
 * Each stage's target is discovered from the links the role can actually see (nothing is hardcoded
 * except a preference for the Meridian demo project when the role has it), then opened and checked
 * for an error state. A stage with nothing to open for a role is reported as skipped, never as
 * passed. Navigation only: no link outside the app's own routes is followed and no form is used.
 */

const PREFERRED_PROJECT = process.env.E2E_PROJECT_ID ?? "c0000000-0000-0000-0000-000000000001";
const PROJECT_TABS = ["itps", "ncrs", "punch-list", "observations", "registers", "activity", "kpis", "data-book", "reports", "guide", "audit-log"];

interface Targets {
  projectId: string | null;
  itpId: string | null;
  checklistId: string | null;
  inspectionId: string | null;
  ncrId: string | null;
  vaultFolderPath: string | null;
  vaultDocumentPath: string | null;
  notes: string[];
}

async function settle(page: Page, path: string): Promise<string[]> {
  await page.goto(path, { waitUntil: "load" });
  await page.locator("h1").first().waitFor({ timeout: 20_000 }).catch(() => undefined);
  return [];
}

const idOf = (href: string) => href.split("?")[0].split("/").pop()!;

async function discover(page: Page): Promise<Targets> {
  const t: Targets = { projectId: null, itpId: null, checklistId: null, inspectionId: null, ncrId: null, vaultFolderPath: null, vaultDocumentPath: null, notes: [] };

  // project
  await settle(page, "/inspect/projects");
  const projects = (await appHrefs(page, uuidPath("/inspect/projects"))).map(idOf);
  t.projectId = projects.includes(PREFERRED_PROJECT) ? PREFERRED_PROJECT : (projects[0] ?? null);
  if (!t.projectId) {
    t.notes.push("no projects visible");
    return t;
  }

  // ITP -> checklist -> inspection: try a few ITPs of the project until one has a checklist.
  await settle(page, `/inspect/projects/${t.projectId}?tab=itps`);
  const itps = (await appHrefs(page, uuidPath("/inspect/itps"))).map(idOf).slice(0, 6);
  t.itpId = itps[0] ?? null;
  if (!t.itpId) t.notes.push("project has no ITP visible to this role");
  for (const itpId of itps) {
    await settle(page, `/inspect/itps/${itpId}/checklists`);
    const checklists = (await appHrefs(page, uuidPath("/inspect/checklists"))).map(idOf);
    if (checklists.length === 0) continue;
    t.itpId = itpId;
    t.checklistId = checklists[0];
    for (const checklistId of checklists.slice(0, 3)) {
      await settle(page, `/inspect/checklists/${checklistId}`);
      const inspections = (await appHrefs(page, uuidPath("/inspect/inspections"))).map(idOf);
      if (inspections.length > 0) {
        t.checklistId = checklistId;
        t.inspectionId = inspections[0];
        break;
      }
    }
    break;
  }
  if (t.itpId && !t.checklistId) t.notes.push("no checklist under the project's ITPs");
  if (t.checklistId && !t.inspectionId) t.notes.push("checklist has no inspection record");

  // NCR: prefer one reachable from the project's NCR tab, else the register.
  await settle(page, `/inspect/projects/${t.projectId}?tab=ncrs`);
  let ncrs = (await appHrefs(page, uuidPath("/inspect/ncrs"))).map(idOf);
  if (ncrs.length === 0) {
    await settle(page, "/inspect/ncrs");
    ncrs = (await appHrefs(page, uuidPath("/inspect/ncrs"))).map(idOf);
  }
  t.ncrId = ncrs[0] ?? null;
  if (!t.ncrId) t.notes.push("no NCR visible");

  // Vault: first folder of the project (the vault index takes ?project=), and a document if any.
  await settle(page, `/inspect/vault?project=${t.projectId}`);
  const folders = await appHrefs(page, new RegExp(`^/inspect/vault/${t.projectId}/[0-9a-f-]{36}$`, "i"));
  t.vaultFolderPath = folders[0] ?? null;
  if (!t.vaultFolderPath) {
    await settle(page, "/inspect/vault");
    const anyFolder = await appHrefs(page, /^\/inspect\/vault\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i);
    t.vaultFolderPath = anyFolder[0] ?? null;
  }
  if (t.vaultFolderPath) {
    const docHrefs = await appHrefs(page, /^\/inspect\/vault\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i);
    for (const folder of [t.vaultFolderPath, ...docHrefs.filter((h) => h !== t.vaultFolderPath)].slice(0, 4)) {
      await settle(page, folder);
      const withDoc = await page.locator("a[href*='?doc=']").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
      const m = withDoc.map((h) => h.match(/^(\/inspect\/vault\/[0-9a-f-]{36})\/[0-9a-f-]{36}\?doc=([0-9a-f-]{36})/i)).find(Boolean);
      if (m) {
        t.vaultDocumentPath = `${m[1]}/document/${m[2]}`;
        break;
      }
    }
  } else {
    t.notes.push("no vault folder visible");
  }
  if (t.vaultFolderPath && !t.vaultDocumentPath) t.notes.push("no vault document in the first folders");
  return t;
}

for (const role of ROLES) {
  test.describe(`${role.label}`, () => {
    let context: BrowserContext;
    let page: Page;
    let targets: Targets;
    let discoveryError: string | null = null;
    let mutations: string[];

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(240_000);
      context = await contextAs(browser, role);
      page = await context.newPage();
      mutations = watchForMutations(page).violations;
      try {
        targets = await discover(page);
      } catch (error) {
        discoveryError = String(error);
        targets = { projectId: null, itpId: null, checklistId: null, inspectionId: null, ncrId: null, vaultFolderPath: null, vaultDocumentPath: null, notes: [] };
      }
    });
    test.afterAll(async () => {
      await context?.close();
    });

    const expectRenders = (probe: PageProbe, target: string) => {
      if (probe.consoleErrors.length) {
        test.info().annotations.push({ type: "console-error", description: `${target}: ${probe.consoleErrors.slice(0, 2).join(" | ").slice(0, 300)}` });
      }
      expect(probe.status, `HTTP status for ${target}`).toBeLessThan(400);
      expect(probe.finalPath, "must not bounce to sign-in").not.toMatch(/^\/login/);
      expect(probe.errorText, `error text rendered on ${target} (h1 "${probe.heading}")`).toBeNull();
      expect(probe.heading, `an <h1> should render on ${target}`).not.toBe("");
    };

    const needs = (value: string | null, what: string) => {
      expect(discoveryError, "target discovery crashed").toBeNull();
      test.skip(value === null, `Skipped: ${what} (${targets.notes.join("; ") || "nothing visible to this role"})`);
    };

    test("1. project hub opens", async () => {
      needs(targets.projectId, "no project visible");
      expectRenders(await probePage(page, `/inspect/projects/${targets.projectId}`), "project hub");
    });

    test("1b. project tabs open", async () => {
      test.setTimeout(240_000); // 11 tabs on a slow dev site
      needs(targets.projectId, "no project visible");
      const problems: string[] = [];
      for (const tab of PROJECT_TABS) {
        const probe = await probePage(page, `/inspect/projects/${targets.projectId}?tab=${tab}`);
        if (probe.status !== null && probe.status >= 400) problems.push(`${tab}: HTTP ${probe.status}`);
        if (probe.finalPath.startsWith("/login")) problems.push(`${tab}: bounced to sign-in`);
        if (probe.errorText) problems.push(`${tab}: error text "${probe.errorText}"`);
      }
      expect(problems, problems.join("\n")).toEqual([]);
    });

    test("1c. project sub-pages open (reports, data book, registers, activity, KPIs, punch list)", async () => {
      test.setTimeout(240_000);
      needs(targets.projectId, "no project visible");
      const problems: string[] = [];
      for (const sub of ["reports", "data-book", "registers", "activity", "kpis", "punch-list", "guide"]) {
        const probe = await probePage(page, `/inspect/projects/${targets.projectId}/${sub}`);
        if (probe.status !== null && probe.status >= 400) problems.push(`${sub}: HTTP ${probe.status}`);
        if (probe.finalPath.startsWith("/login")) problems.push(`${sub}: bounced to sign-in`);
        if (probe.errorText) problems.push(`${sub}: error text "${probe.errorText}"`);
      }
      expect(problems, problems.join("\n")).toEqual([]);
    });

    test("2. ITP page, checklists list, completion and approval roadmaps open", async () => {
      needs(targets.itpId, "no ITP visible");
      const problems: string[] = [];
      for (const sub of ["", "/checklists", "/status", "/approval-roadmap"]) {
        const probe = await probePage(page, `/inspect/itps/${targets.itpId}${sub}`);
        if (probe.status !== null && probe.status >= 400) problems.push(`itp${sub}: HTTP ${probe.status}`);
        if (probe.finalPath.startsWith("/login")) problems.push(`itp${sub}: bounced to sign-in`);
        if (probe.errorText) problems.push(`itp${sub}: error text "${probe.errorText}"`);
      }
      expect(problems, problems.join("\n")).toEqual([]);
    });

    test("3. checklist page opens", async () => {
      needs(targets.checklistId, "no checklist visible");
      expectRenders(await probePage(page, `/inspect/checklists/${targets.checklistId}`), "checklist");
    });

    test("4. inspection page opens", async () => {
      needs(targets.inspectionId, "no inspection record visible");
      expectRenders(await probePage(page, `/inspect/inspections/${targets.inspectionId}`), "inspection");
    });

    test("5. NCR page opens", async () => {
      needs(targets.ncrId, "no NCR visible");
      expectRenders(await probePage(page, `/inspect/ncrs/${targets.ncrId}`), "NCR");
    });

    test("6. vault folder and document page open", async () => {
      needs(targets.vaultFolderPath, "no vault folder visible");
      expectRenders(await probePage(page, targets.vaultFolderPath!), "vault folder");
      if (targets.vaultDocumentPath) {
        expectRenders(await probePage(page, targets.vaultDocumentPath), "vault document");
      } else {
        test.info().annotations.push({ type: "skipped-step", description: "vault document page: no document in the folders checked" });
      }
    });

    test("7. handover: portal (staff/client) and data book open", async () => {
      needs(targets.projectId, "no project visible");
      if (role.isStaff || role.key === "client") {
        expectRenders(await probePage(page, "/inspect/handover"), "handover portal");
      }
      expectRenders(await probePage(page, `/inspect/projects/${targets.projectId}/data-book`), "project data book");
    });

    test("no write requests were made during the walk", async () => {
      expect(mutations).toEqual([]);
    });
  });
}
