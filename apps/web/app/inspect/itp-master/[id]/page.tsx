import { notFound, redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";
import {
  ITP_MASTER_TEMPLATES_TABLE,
  ITP_MASTER_SECTIONS_TABLE,
  type ItpMasterTemplateRow,
} from "@/lib/itp-master/types";
import { ITP_MASTER_REVISIONS_TABLE, type ItpMasterRevisionRow } from "@/lib/itp-master/revision-types";
import { VersionHistoryPanel } from "./version-history-panel";
import { DefaultLevels } from "./default-levels";
import { MasterAdminPanel } from "./admin-panel";
import Link from "next/link";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

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
  const tl = await getTranslator();
  const { id } = await params;
  const session = await requireSession();
  if (!session.isJagsStaff) redirect("/inspect/itps");

  const supabase = await createSupabaseServerClient();

  const { data: template } = await supabase
    .from(ITP_MASTER_TEMPLATES_TABLE)
    .select("id, title, industry, applicable_standard, discipline_id, version, is_active, master_disciplines(name)")
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
  const { data: disciplineList } = canEditDefaults
    ? await supabase.from("master_disciplines").select("id, name").order("name").returns<{ id: string; name: string }[]>()
    : { data: [] as { id: string; name: string }[] };

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

  const { data: auditRows } = await supabase
    .from("itp_master_audit" as never)
    .select("id, action, summary, created_at, users(full_name)" as never)
    .eq("template_id" as never, id as never)
    .order("created_at" as never, { ascending: false })
    .limit(20)
    .returns<{ id: string; action: string; summary: string; created_at: string; users: { full_name: string } | null }[]>();

  type MasterItem = NonNullable<NonNullable<typeof sections>[number]["itp_master_items"]>[number];
  const itemColumns: ResponsiveColumn<MasterItem>[] = [
    { key: "item", header: "Item", tdClassName: "doc-id text-ink", render: (item) => item.item_number },
    { key: "activity", header: "Activity", tdClassName: "text-ink", render: (item) => item.activity },
    { key: "criteria", header: "Acceptance criteria", tdClassName: "text-muted", render: (item) => item.acceptance_criteria ?? "—" },
    { key: "evidence", header: "Evidence", tdClassName: "text-muted", render: (item) => EVIDENCE_LABEL[item.evidence_type] },
    {
      key: "levels",
      header: "Default sign-off levels",
      render: (item) => (
        <DefaultLevels
          templateId={template.id}
          masterItemId={item.id}
          defaults={defaultsByItem.get(item.id) ?? {}}
          editable={canEditDefaults}
        />
      ),
    },
  ];

  return (
    <div>
      <SettingsBackLink href="/inspect/itp-master" label="Master ITP Library" />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-ink">{template.title}</h1>
        <Badge tone={template.is_active ? "success" : "neutral"}>{template.is_active ? "Active" : "Inactive"}</Badge>
        <span className="text-sm text-muted"><T>v</T>{template.version}</span>
        <PageGuide
          title={tl("Master template — how this works")}
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

      {template.is_active && (
        <Link
          href={`/inspect/itps/new?tab=template&template=${template.id}`}
          className="mt-3 inline-flex min-h-11 items-center rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy-dark"
        >
          <T>Use this template</T>
        </Link>
      )}
      {canEditDefaults && (
        <MasterAdminPanel
          templateId={template.id}
          title={template.title}
          industry={template.industry}
          standard={template.applicable_standard}
          disciplineId={template.discipline_id}
          isActive={template.is_active}
          disciplines={disciplineList ?? []}
        />
      )}

      <div className="mt-8 space-y-8">
        {(sections ?? []).map((section) => (
          <div key={section.id} className="rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-4 py-3">
              <h2 className="font-medium text-ink">
                {section.section_number}. {section.title}
              </h2>
            </div>
            <ResponsiveTable
              columns={itemColumns}
              rows={[...(section.itp_master_items ?? [])].sort((a, b) => a.sort_order - b.sort_order)}
              rowKey={(item) => item.id}
              caption={`Activities in ${section.title}`}
              empty="No activities in this section."
              emptyCellClassName="px-3 py-6 text-center text-muted"
              cardClassName="px-3"
            />
          </div>
        ))}
        {(sections ?? []).length === 0 && <p className="text-sm text-muted"><T>No sections in this template.</T></p>}
      </div>

      <VersionHistoryPanel revisions={revisions ?? []} />

      <div className="mt-8 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-ink"><T>Change log</T></h2>
        {(auditRows ?? []).length === 0 ? (
          <p className="mt-1 text-xs text-muted"><T>No administrative changes recorded yet.</T></p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {(auditRows ?? []).map((a) => (
              <li key={a.id} className="text-ink">
                {a.summary}{" "}
                <span className="text-xs text-muted">
                  {new Date(a.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  {a.users?.full_name ? ` · ${a.users.full_name}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
