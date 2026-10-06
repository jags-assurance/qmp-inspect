import { notFound, redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  ITP_MASTER_TEMPLATES_TABLE,
  ITP_MASTER_SECTIONS_TABLE,
  type ItpMasterTemplateRow,
} from "@/lib/itp-master/types";
import { ITP_MASTER_REVISIONS_TABLE, type ItpMasterRevisionRow } from "@/lib/itp-master/revision-types";
import { VersionHistoryPanel } from "./version-history-panel";
import { DefaultLevels } from "./default-levels";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";

const EVIDENCE_LABEL: Record<number, string> = {
  1: "Checklist",
  2: "Document upload",
  3: "Measurement record",
};

interface SectionWithItems {
  id: string;
  section_number: number;
  title: string;
  itp_master_items: {
    id: string;
    item_number: string;
    activity: string;
    acceptance_criteria: string | null;
    evidence_type: 1 | 2 | 3;
    sort_order: number;
  }[];
}

// Read-only view — editing a master template directly is out of scope; the only way content
// enters the master library is via the proposal-approval flow (lib/itp-master/actions.ts).
export default async function MasterTemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!session.isJagsStaff) redirect("/inspect/itps");

  const supabase = await createSupabaseServerClient();

  const { data: template } = await supabase
    .from(ITP_MASTER_TEMPLATES_TABLE)
    .select("id, title, industry, applicable_standard, version, is_active, master_disciplines(name)")
    .eq("id", id)
    .maybeSingle<ItpMasterTemplateRow & { master_disciplines: { name: string } | null }>();

  if (!template) notFound();

  const { data: sections } = await supabase
    .from(ITP_MASTER_SECTIONS_TABLE)
    .select(
      "id, section_number, title, itp_master_items(id, item_number, activity, acceptance_criteria, evidence_type, sort_order)"
    )
    .eq("template_id", id)
    .order("section_number")
    .returns<SectionWithItems[]>();

  const allMasterItemIds = (sections ?? []).flatMap((s) => (s.itp_master_items ?? []).map((i) => i.id));
  const { data: defaultRows } = allMasterItemIds.length
    ? await supabase
        .from("itp_master_item_interventions" as never)
        .select("master_item_id, party_type, intervention")
        .in("master_item_id" as never, allMasterItemIds as never)
        .returns<{ master_item_id: string; party_type: string; intervention: string }[]>()
    : { data: [] as { master_item_id: string; party_type: string; intervention: string }[] };
  const defaultsByItem = new Map<string, Record<string, string>>();
  for (const row of defaultRows ?? []) {
    defaultsByItem.set(row.master_item_id, { ...(defaultsByItem.get(row.master_item_id) ?? {}), [row.party_type]: row.intervention });
  }
  const canEditDefaults = isAdminStaff(session);

  // R31 version history — frozen snapshots of past master template versions, newest first. See
  // lib/itp-master/revisions.ts for what writes these rows.
  const { data: revisions } = await supabase
    .from(ITP_MASTER_REVISIONS_TABLE)
    .select(
      "id, template_id, version, title, industry, applicable_standard, sections_snapshot, reason, created_by, created_at, users(full_name)"
    )
    .eq("template_id", id)
    .order("version", { ascending: false })
    .returns<(ItpMasterRevisionRow & { users: { full_name: string } | null })[]>();

  return (
    <div>
      <SettingsBackLink href="/inspect/itp-master" label="Master ITP Library" />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-ink">{template.title}</h1>
        <Badge tone={template.is_active ? "success" : "neutral"}>{template.is_active ? "Active" : "Inactive"}</Badge>
        <span className="text-sm text-muted">v{template.version}</span>
        <PageGuide
          title="Master template — how this works"
          points={[
            "Sections and activities are read-only here. The one thing a JAGS Admin can set directly is each activity's default sign-off level per party type (Client, Main contractor, Subcontractor, TPI / Lab) — applied to the matching parties whenever a project ITP is created from this template.",
            "The only way content changes is via the proposal flow: a JAGS Admin approves a proposal (from an ITP's own \"Propose to master library\" action) to create a new template or update this one.",
            "Every approved update bumps the version number shown above and freezes a snapshot in the version history panel below, so past versions stay inspectable even after the template moves on.",
            "\"Inactive\" means this version is no longer offered when starting a new project ITP from a template, but it's kept for record-keeping.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        {template.industry || "—"} · {template.master_disciplines?.name ?? "—"}
        {template.applicable_standard ? ` · ${template.applicable_standard}` : ""}
      </p>

      <div className="mt-8 space-y-8">
        {(sections ?? []).map((section) => (
          <div key={section.id} className="rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-4 py-3">
              <h2 className="font-medium text-ink">
                {section.section_number}. {section.title}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 font-medium">Activity</th>
                    <th className="px-3 py-2 font-medium">Acceptance criteria</th>
                    <th className="px-3 py-2 font-medium">Evidence</th>
                    <th className="px-3 py-2 font-medium">Default sign-off levels</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(section.itp_master_items ?? [])]
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((item) => (
                      <tr key={item.id} className="border-b border-border last:border-0">
                        <td className="doc-id px-3 py-2 text-ink">{item.item_number}</td>
                        <td className="px-3 py-2 text-ink">{item.activity}</td>
                        <td className="px-3 py-2 text-muted">{item.acceptance_criteria ?? "—"}</td>
                        <td className="px-3 py-2 text-muted">{EVIDENCE_LABEL[item.evidence_type]}</td>
                        <td className="px-3 py-2">
                          <DefaultLevels
                            templateId={template.id}
                            masterItemId={item.id}
                            defaults={defaultsByItem.get(item.id) ?? {}}
                            editable={canEditDefaults}
                          />
                        </td>
                      </tr>
                    ))}
                  {(section.itp_master_items ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-muted">
                        No activities in this section.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {(sections ?? []).length === 0 && <p className="text-sm text-muted">No sections in this template.</p>}
      </div>

      <VersionHistoryPanel revisions={revisions ?? []} />
    </div>
  );
}
