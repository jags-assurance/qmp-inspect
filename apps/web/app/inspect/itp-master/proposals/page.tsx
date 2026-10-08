import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ITP_MASTER_PROPOSALS_TABLE,
  ITP_MASTER_TEMPLATES_TABLE,
  type ItpMasterProposedAction,
} from "@/lib/itp-master/types";
import { ProposalReviewForm } from "./proposal-review-form";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

interface ProposalWithSourceItp {
  id: string;
  proposed_action: ItpMasterProposedAction;
  target_template_id: string | null;
  proposed_title: string | null;
  proposal_notes: string | null;
  created_at: string;
  itps: { id: string; itp_number: string; title: string } | null;
}

interface DiffItem {
  item_number: string;
  activity: string;
  acceptance_criteria: string | null;
  evidence_type: number;
}
interface DiffSection {
  section_number: number;
  title: string;
  items: DiffItem[];
}
type SrcSection = { section_number: number; title: string; itp_items: DiffItem[] };
type MasterSection = { section_number: number; title: string; itp_master_items: DiffItem[] };

function computeDiff(source: DiffSection[], current: DiffSection[]) {
  const key = (sec: number, it: string) => `${sec}::${it}`;
  const cur = new Map<string, DiffItem>();
  const src = new Map<string, DiffItem>();
  for (const sec of current) for (const it of sec.items) cur.set(key(sec.section_number, it.item_number), it);
  for (const sec of source) for (const it of sec.items) src.set(key(sec.section_number, it.item_number), it);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [k, it] of src) {
    const c = cur.get(k);
    if (!c) added.push(`${it.item_number} ${it.activity}`);
    else if (
      c.activity !== it.activity ||
      (c.acceptance_criteria ?? "") !== (it.acceptance_criteria ?? "") ||
      c.evidence_type !== it.evidence_type
    )
      changed.push(`${it.item_number} ${c.activity === it.activity ? it.activity : `${c.activity} -> ${it.activity}`}`);
  }
  for (const [k, it] of cur) if (!src.has(k)) removed.push(`${it.item_number} ${it.activity}`);
  return { added, removed, changed };
}

function DiffList({ label, items, tone }: { label: string; items: string[]; tone: string }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <p className={`text-xs font-medium ${tone}`}>
        {label} ({items.length})
      </p>
      <ul className="mt-0.5 list-disc ps-5 text-xs text-ink">
        {items.slice(0, 40).map((x, i) => (
          <li key={i} className="break-words">
            {x}
          </li>
        ))}
        {items.length > 40 && <li className="text-muted"><T>and</T> {items.length - 40} <T>more</T></li>}
      </ul>
    </div>
  );
}

export default async function ItpMasterProposalsPage() {
  const tl = await getTranslator();
  const session = await requireSession();
  if (!session.isJagsStaff) redirect("/inspect/itps");

  const supabase = await createSupabaseServerClient();

  const [{ data: proposals }, { data: templates }] = await Promise.all([
    supabase
      .from(ITP_MASTER_PROPOSALS_TABLE)
      .select("id, proposed_action, target_template_id, proposed_title, proposal_notes, created_at, itps(id, itp_number, title)")
      .eq("status", "pending")
      .order("created_at")
      .returns<ProposalWithSourceItp[]>(),
    supabase.from(ITP_MASTER_TEMPLATES_TABLE).select("id, title").returns<{ id: string; title: string }[]>(),
  ]);

  const templateTitleById = new Map((templates ?? []).map((t) => [t.id, t.title]));

  // Diff preview: source ITP content vs the current master template (update_existing proposals only).
  const diffs = new Map<string, { added: string[]; removed: string[]; changed: string[] } | { newCount: number }>();
  for (const proposal of proposals ?? []) {
    if (!proposal.itps) continue;
    const { data: srcSecs } = await supabase
      .from("itp_sections")
      .select("section_number, title, itp_items(item_number, activity, acceptance_criteria, evidence_type)")
      .eq("itp_id", proposal.itps.id)
      .returns<SrcSection[]>();
    const source: DiffSection[] = (srcSecs ?? []).map((x) => ({ section_number: x.section_number, title: x.title, items: x.itp_items ?? [] }));
    if (proposal.proposed_action === "update_existing" && proposal.target_template_id) {
      const { data: curSecs } = await supabase
        .from("itp_master_sections")
        .select("section_number, title, itp_master_items(item_number, activity, acceptance_criteria, evidence_type)")
        .eq("template_id", proposal.target_template_id)
        .returns<MasterSection[]>();
      const current: DiffSection[] = (curSecs ?? []).map((x) => ({ section_number: x.section_number, title: x.title, items: x.itp_master_items ?? [] }));
      diffs.set(proposal.id, computeDiff(source, current));
    } else {
      diffs.set(proposal.id, { newCount: source.reduce((n, x) => n + x.items.length, 0) });
    }
  }

  return (
    <div>
      <SettingsBackLink href="/inspect/itp-master" label="Master ITP Library" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink"><T>Master Library Proposals</T></h1>
            <PageGuide
              title={tl("Master Library Proposals — how this works")}
              points={[
                "A proposal is raised from a project's own ITP once it's approved or client-accepted (\"Propose to master library\" on the ITP page) — either as a brand new template or an update to an existing one.",
                "Only a JAGS Admin can approve or reject a pending proposal; other JAGS staff can see this queue but only get an \"Awaiting review by a JAGS Admin\" note instead of the review form.",
                "This list only ever shows pending proposals — approved or rejected ones drop off once actioned.",
                "Approving a proposal is what actually creates or revises the master template and bumps its version — nothing here edits the library directly.",
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">
            <T>Pending proposals to add a new master template, or update an existing one, from a project&apos;s own ITP.</T>
          </p>
        </div>
        <Link href="/inspect/itp-master" className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white">
          <T>← Library</T>
        </Link>
      </div>

      <div className="mt-6 space-y-4">
        {(proposals ?? []).map((proposal) => (
          <div key={proposal.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-ink">
                  {proposal.proposed_action === "new_template"
                    ? `New template: ${proposal.proposed_title || proposal.itps?.title || "Untitled"}`
                    : `Update existing: ${templateTitleById.get(proposal.target_template_id ?? "") ?? "Unknown template"}`}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  <T>From</T> {proposal.itps ? `${proposal.itps.itp_number} — ${proposal.itps.title}` : "an ITP"} ·{" "}
                  {new Date(proposal.created_at).toLocaleDateString("en-GB")}
                </p>
              </div>
              {proposal.itps && (
                <Link href={`/inspect/itps/${proposal.itps.id}`} className="text-sm text-burgundy hover:underline">
                  <T>View source ITP →</T>
                </Link>
              )}
            </div>
            {proposal.proposal_notes && <p className="mt-2 text-sm text-muted">{proposal.proposal_notes}</p>}
            {(() => {
              const d = diffs.get(proposal.id);
              if (!d) return null;
              return (
                <details className="mt-3 rounded-md border border-border px-3 py-2" open>
                  <summary className="cursor-pointer select-none text-sm font-medium text-ink"><T>Changes vs current template</T></summary>
                  {"newCount" in d ? (
                    <p className="mt-2 text-xs text-muted"><T>New template with</T> {d.newCount} <T>activities.</T></p>
                  ) : d.added.length + d.removed.length + d.changed.length === 0 ? (
                    <p className="mt-2 text-xs text-muted"><T>No activity differences from the current template.</T></p>
                  ) : (
                    <>
                      <DiffList label="Added" items={d.added} tone="text-success" />
                      <DiffList label="Removed" items={d.removed} tone="text-danger" />
                      <DiffList label="Changed" items={d.changed} tone="text-ink" />
                    </>
                  )}
                </details>
              );
            })()}
            {isAdminStaff(session) ? (
              <ProposalReviewForm proposalId={proposal.id} />
            ) : (
              <p className="mt-3 text-xs text-muted"><T>Awaiting review by a JAGS Admin.</T></p>
            )}
          </div>
        ))}
        {(proposals ?? []).length === 0 && (
          <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
            <T>No pending proposals.</T>
          </p>
        )}
      </div>
    </div>
  );
}
