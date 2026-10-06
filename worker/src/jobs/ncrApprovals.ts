// Shared helpers for the NCR PDFs' APPROVALS block: one box per party type present on the project
// (JAGS inspector/raiser, client representative, main contractor, subcontractor, TPI / lab), filled
// from recorded NCR actions by a user belonging to that party, else an empty signature line.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface NcrApprovalBox {
  label: string;
  organisation: string | null;
  /** e.g. "Raised by" / "Closed by"; null when no recorded action. */
  action: string | null;
  name: string | null;
  date: string | null;
}

export interface NcrActionRecord {
  userId: string | null;
  userName: string | null;
  action: string;
  date: string | null;
}

interface PartyRow {
  id: string;
  party_type: string;
  name: string;
  user_id: string | null;
}

const PARTY_ORDER: { type: string; label: string }[] = [
  { type: "client", label: "Client representative" },
  { type: "main_contractor", label: "Main contractor" },
  { type: "subcontractor", label: "Subcontractor" },
  { type: "tpi_lab", label: "TPI / Lab" },
];

export function formatApprovalDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}

export async function loadNcrParties(
  supabase: SupabaseClient<any, any, any>,
  projectId: string
): Promise<PartyRow[]> {
  const { data } = await supabase
    .from("project_parties")
    .select("id, party_type, name, user_id")
    .eq("project_id", projectId)
    .eq("is_active", true);
  return ((data ?? []) as unknown as PartyRow[]) ?? [];
}

export function buildNcrApprovalBoxes(
  parties: PartyRow[],
  actions: NcrActionRecord[],
  jagsOrganisationName: string | null
): NcrApprovalBox[] {
  const used = new Set<NcrActionRecord>();
  const boxes: NcrApprovalBox[] = [];

  for (const p of PARTY_ORDER) {
    const group = parties.filter((x) => x.party_type === p.type);
    if (group.length === 0) continue;
    const userIds = new Set(group.map((g) => g.user_id).filter(Boolean) as string[]);
    const hit = actions.find((a) => a.userId && userIds.has(a.userId) && !used.has(a));
    if (hit) used.add(hit);
    boxes.push({
      label: p.label,
      organisation: group.map((g) => g.name).join(" / "),
      action: hit ? hit.action : null,
      name: hit?.userName ?? null,
      date: hit ? formatApprovalDate(hit.date) : null,
    });
  }

  const jagsIds = new Set(parties.filter((x) => x.party_type === "jags").map((x) => x.user_id).filter(Boolean) as string[]);
  const jagsHit =
    actions.find((a) => a.userId && jagsIds.has(a.userId) && !used.has(a)) ?? actions.find((a) => !used.has(a));
  const jagsBox: NcrApprovalBox = {
    label: "JAGS inspector / raiser",
    organisation: jagsOrganisationName,
    action: jagsHit ? jagsHit.action : null,
    name: jagsHit?.userName ?? null,
    date: jagsHit ? formatApprovalDate(jagsHit.date) : null,
  };
  return [jagsBox, ...boxes];
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const NCR_APPROVALS_CSS = `
  .approvals { margin-top: 6px; break-inside: avoid; page-break-inside: avoid; }
  .approvals h2 { break-after: avoid; page-break-after: avoid; margin-bottom: 4px; }
  .approvals-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; break-inside: avoid; page-break-inside: avoid; }
  .approval-card {
    border: 1px solid #ccc; border-top: 3px solid var(--burgundy); border-radius: 2px;
    padding: 4px 7px 5px 7px; background: #fff; break-inside: avoid; page-break-inside: avoid;
  }
  .approval-card-label { font-size: 7.5px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4px; color: var(--burgundy); }
  .approval-card-org { font-size: 8px; color: #555; min-height: 10px; }
  .approval-card-name { font-size: 9.5px; font-weight: bold; min-height: 12px; margin-top: 2px; }
  .approval-card-name small { font-weight: normal; color: #777; font-size: 7px; text-transform: uppercase; margin-right: 3px; }
  .approval-card-line { border-bottom: 1px solid #999; margin: 12px 0 3px 0; }
  .approval-card-date { font-size: 8px; color: #444; }
`;

export function renderNcrApprovalsHtml(boxes: NcrApprovalBox[]): string {
  const cards = boxes
    .map(
      (b) => `
      <div class="approval-card">
        <div class="approval-card-label">${esc(b.label)}</div>
        <div class="approval-card-org">${b.organisation ? esc(b.organisation) : "&nbsp;"}</div>
        <div class="approval-card-name">${b.name ? `${b.action ? `<small>${esc(b.action)}</small>` : ""}${esc(b.name)}` : "&nbsp;"}</div>
        <div class="approval-card-line"></div>
        <div class="approval-card-date">Date ${b.date ? esc(b.date) : "____________"}</div>
      </div>`
    )
    .join("");
  return `
  <div class="section approvals">
    <h2>Approvals</h2>
    <div class="approvals-grid">${cards}</div>
  </div>`;
}
