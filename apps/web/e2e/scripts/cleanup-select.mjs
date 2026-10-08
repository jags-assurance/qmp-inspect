/**
 * Pure selection logic for e2e/scripts/cleanup-e2e-data.mjs: decides which organisations and projects the
 * cleanup may remove. No I/O, so it is unit-tested (lib/e2e/__tests__/cleanup-plan.test.ts) and the safety
 * rules cannot drift unnoticed.
 *
 * A project is removable only when ALL of these hold:
 *   - its name AND its project number start with `E2E-` (case-sensitive)
 *   - its organisation's name starts with `E2E-` (the write suite always creates both together; a project
 *     someone typed "E2E-..." into under a real client organisation is NOT the suite's and is left alone)
 *   - when a run tag is given, name and number both start with that tag
 * An organisation is removable only when its own name qualifies the same way AND every project it holds
 * (E2E- or not) is itself removable, so deleting it can never take a non-E2E project with it.
 */
export const E2E_PREFIX = "E2E-";

const startsWith = (value, prefix) => typeof value === "string" && value.startsWith(prefix);

/**
 * @param {{ organizations: {id: string, name: string}[], projects: {id: string, name: string, project_number: string, organization_id: string}[], runTag?: string | null }} input
 * @returns {{ organizations: {id: string, name: string}[], projects: {id: string, name: string, project_number: string, organization_id: string}[], skipped: {kind: "organization" | "project", id: string, name: string, reason: string}[] }}
 */
export function planCleanup({ organizations, projects, runTag = null }) {
  if (runTag !== null && runTag !== undefined && runTag !== "" && !startsWith(runTag, E2E_PREFIX)) {
    throw new Error(`run tag "${runTag}" must start with ${E2E_PREFIX}`);
  }
  const prefix = runTag ? runTag : E2E_PREFIX;
  const orgById = new Map(organizations.map((o) => [o.id, o]));
  const skipped = [];

  const projectQualifies = (p) => startsWith(p.name, prefix) && startsWith(p.project_number, prefix);
  const orgQualifies = (o) => startsWith(o?.name, prefix);

  const removableProjects = [];
  for (const p of projects) {
    const org = orgById.get(p.organization_id);
    if (!projectQualifies(p)) {
      // Only worth mentioning when it sits inside an E2E- organisation (it blocks that organisation).
      if (orgQualifies(org)) skipped.push({ kind: "project", id: p.id, name: p.name, reason: `inside an ${E2E_PREFIX} organisation but its name/number does not start with ${prefix}` });
      continue;
    }
    if (!orgQualifies(org)) {
      skipped.push({ kind: "project", id: p.id, name: p.name, reason: `named ${prefix}... but its organisation "${org?.name ?? "unknown"}" is not an ${E2E_PREFIX} organisation` });
      continue;
    }
    removableProjects.push(p);
  }

  const removableIds = new Set(removableProjects.map((p) => p.id));
  const removableOrgs = [];
  for (const o of organizations) {
    if (!orgQualifies(o)) {
      if (startsWith(o.name, E2E_PREFIX)) skipped.push({ kind: "organization", id: o.id, name: o.name, reason: `does not match the run tag ${prefix}` });
      continue;
    }
    const blockers = projects.filter((p) => p.organization_id === o.id && !removableIds.has(p.id));
    if (blockers.length > 0) {
      skipped.push({ kind: "organization", id: o.id, name: o.name, reason: `holds ${blockers.length} project(s) that are not removable (${blockers.map((b) => b.name).join(", ")})` });
      continue;
    }
    removableOrgs.push(o);
  }
  return { organizations: removableOrgs, projects: removableProjects, skipped };
}
