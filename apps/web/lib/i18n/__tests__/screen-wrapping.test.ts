import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { translateText } from "../dictionary";

// Key screens (relative to apps/web). The lint rule i18next/no-literal-string is the full worklist; this
// test pins the screens that were migrated for S12 so a new hard-coded English string in them fails CI.
const SCREENS = [
  "app/login/login-form.tsx",
  "app/inspect/admin-dashboard.tsx",
  "app/inspect/inspector-dashboard.tsx",
  "app/inspect/external-party-dashboard.tsx",
  "app/inspect/projects/page.tsx",
  "app/inspect/projects/new/new-project-form.tsx",
  "app/inspect/projects/[projectId]/add-project-party-form.tsx",
  "app/inspect/projects/[projectId]/punch-list/add-punch-item-form.tsx",
  "app/inspect/projects/[projectId]/punch-list/punch-list-table.tsx",
  "app/inspect/inspections/page.tsx",
  "app/inspect/inspections/inspections-table.tsx",
  "app/inspect/ncrs/page.tsx",
  "app/inspect/ncrs/new/new-ncr-form.tsx",
  "app/inspect/observations/page.tsx",
  "app/inspect/itps/new/new-itp-form.tsx",
  "app/inspect/vault/[projectId]/[folderId]/vault-documents-table.tsx",
  "app/inspect/organisation/data-requests/page.tsx",
  "app/inspect/organisation/data-requests/anonymise-control.tsx",
];

const root = join(__dirname, "..", "..", "..");

const ENTITIES: Record<string, string> = { apos: "'", quot: '"', amp: "&", lt: "<", gt: ">", nbsp: "\u00a0", rsquo: "\u2019", lsquo: "\u2018", mdash: "\u2014", ndash: "\u2013", middot: "\u00b7", hellip: "\u2026" };
const decode = (t: string) => t.replace(/&(\w+);/g, (m, n: string) => ENTITIES[n] ?? m);

function scan(file: string) {
  const text = readFileSync(join(root, file), "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bare: string[] = [];
  const wrapped: string[] = [];
  const rawAttrs: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n)) {
      const t = decode(n.getText()).replace(/\s+/g, " ").trim();
      if (/[A-Za-z]{2}/.test(t)) {
        const parent = n.parent;
        const tag = ts.isJsxElement(parent) ? parent.openingElement.tagName.getText() : "";
        if (tag === "T" || tag === "Tx") wrapped.push(t);
        else bare.push(t);
      }
    }
    if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer) && n.name.getText() === "placeholder") {
      if (/[A-Za-z]{2}/.test(n.initializer.text)) rawAttrs.push(n.initializer.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { bare, wrapped, rawAttrs };
}

describe("key screens route their visible text through the translation helpers", () => {
  for (const file of SCREENS) {
    it(file, () => {
      const { bare, wrapped, rawAttrs } = scan(file);
      expect(bare, "bare JSX text (wrap it in <T> or <Tx>)").toEqual([]);
      expect(rawAttrs, "raw placeholder (use the translator)").toEqual([]);
    });
  }
});
