import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { CHECKLIST_TEMPLATES_TABLE, type ChecklistTemplateRow } from "@/lib/checklists/db-types";
import { CHECKLIST_LIBRARY_TEMPLATES_TABLE } from "@/lib/checklist-library/types";
import { GenerateChecklistsButton } from "./generate-button";
import { AttachLibraryTemplateForm } from "./attach-library-template-form";
import { ITP_STATUS_LABEL } from "../../itps-table";
import { PageGuide } from "@/components/domain/page-guide";

/**
 * Lists every checklist-type (evidence_type = 1) activity on an ITP, generates checklists for an
 * approved ITP that doesn't have them yet (R48), and links into each one's fill page. Kept as its
 * own route rather than folded into the ITP detail page so that page's existing content and tests
 * don't need to change.
 */
export default async function ItpChecklistsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: itp } = await supabase
    .from("itps")
    .select(
      "id, itp_number, title, status, project_id, projects(name, organization_id, allow_client_itp_creation, allow_contractor_itp_creation, organizations(name, engagement_scope))"
    )
    .eq("id", id)
    .maybeSingle<{
      id: string;
      itp_number: string;
      title: string;
      status: "draft" | "under_review" | "approved" | "client_accepted";
      project_id: string;
      projects: {
        name: string;
        organization_id: string;
        allow_client_itp_creation: boolean;
        allow_contractor_itp_creation: boolean;
        organizations: { name: string; engagement_scope: string } | null;
      } | null;
    }>();

  if (!itp) notFound();

  const { data: sections } = await supabase.from("itp_sections").select("id").eq("itp_id", id);
  const sectionIds = (sections ?? []).map((s) => s.id);

  const { data: items } = await supabase
    .from("itp_items")
    .select("id, item_number, activity")
    .in("section_id", sectionIds.length > 0 ? sectionIds : ["00000000-0000-0000-0000-000000000000"])
    .eq("evidence_type", 1)
    .order("item_number");

  const itemIds = (items ?? []).map((i) => i.id);
  const { data: templates } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select("id, itp_item_id, checklist_number")
    .in("itp_item_id", itemIds.length > 0 ? itemIds : ["00000000-0000-0000-0000-000000000000"])
    .returns<Pick<ChecklistTemplateRow, "id" | "itp_item_id" | "checklist_number">[]>();

  const templateByItem = new Map((templates ?? []).map((t) => [t.itp_item_id, t]));

  // Real-world gap found live: this table previously had no status column at all — the only way to
  // tell whether a checklist had been started, or completed pass/fail, was to open every single one.
  // inspection_records gets its row at "Start inspection" time (overall_result null) and only gets
  // overall_result set at "Complete inspection" — so a row's mere existence is "in progress", and a
  // set overall_result is "complete" — no need to touch checklist_responses at all. A template can
  // have more than one inspection_record over time (e.g. a re-inspection after a fail), so this
  // takes the most recently created one per template as the current status.
  const templateIds = (templates ?? []).map((t) => t.id);
  const { data: inspectionRecords } =
    templateIds.length > 0
      ? await supabase
          .from("inspection_records")
          .select("checklist_template_id, overall_result, created_at")
          .in("checklist_template_id", templateIds)
          .order("created_at", { ascending: false })
          .returns<{ checklist_template_id: string | null; overall_result: string | null; created_at: string }[]>()
      : { data: [] as { checklist_template_id: string | null; overall_result: string | null; created_at: string }[] };

  const latestByTemplateId = new Map<string, string | null>();
  for (const row of inspectionRecords ?? []) {
    if (row.checklist_template_id && !latestByTemplateId.has(row.checklist_template_id)) {
      latestByTemplateId.set(row.checklist_template_id, row.overall_result);
    }
  }

  const RESULT_LABEL: Record<string, { label: string; tone: "success" | "danger" | "warning" }> = {
    pass: { label: "Complete — Pass", tone: "success" },
    fail: { label: "Complete — Fail", tone: "danger" },
    partial: { label: "Complete — Partial", tone: "warning" },
  };

  function statusFor(templateId: string | undefined): { label: string; tone: "success" | "danger" | "warning" | "neutral" } {
    if (!templateId) return { label: "Not generated yet", tone: "neutral" };
    if (!latestByTemplateId.has(templateId)) return { label: "Not started", tone: "neutral" };
    const result = latestByTemplateId.get(templateId);
    return (result && RESULT_LABEL[result]) || { label: "In progress", tone: "warning" };
  }

  // R44/R47: staff can start a checklist-type activity's checklist from a reusable library
  // template instead of the blank auto-generate path — see lib/checklist-library/actions.ts's
  // attachLibraryTemplateToActivityAction. The library itself is staff-only (RLS), so this option
  // only ever needs to be offered to staff.
  // R46: only offer templates that are global (organization_id null) or scoped to this ITP's own
  // project's organisation — a template built for one client should never show up as an attach
  // option on a different client's ITP, even though staff can browse the whole library elsewhere.
  const { data: rawLibraryTemplates } = session.isJagsStaff
    ? await supabase
        .from(CHECKLIST_LIBRARY_TEMPLATES_TABLE)
        .select("id, title, organization_id")
        .order("title")
        .returns<{ id: string; title: string; organization_id: string | null }[]>()
    : { data: null };
  const libraryTemplates = (rawLibraryTemplates ?? []).filter(
    (t) => t.organization_id === null || t.organization_id === itp.projects?.organization_id
  );

  // Generating checklists is scaffolding on top of already-approved activities, not a
  // certification act — the same eligible party who can build the ITP draft
  // (is_client_itp_creator) can now also trigger this themselves once approved, mirrored at the
  // RLS layer by is_client_checklist_generator (20260921000000_self_managed_submit_and_checklist_
  // gen.sql). Approve itself stays JAGS-only and is untouched by this.
  let isEligibleChecklistGenerator = false;
  if (!session.isJagsStaff && itp.status === "approved") {
    const { data: myParty } = await supabase
      .from("project_parties")
      .select("party_type, is_active")
      .eq("project_id", itp.project_id)
      .eq("user_id", session.userId)
      .maybeSingle<{ party_type: string; is_active: boolean }>();

    if (myParty?.is_active) {
      if (myParty.party_type === "client") {
        isEligibleChecklistGenerator =
          !!itp.projects?.allow_client_itp_creation ||
          itp.projects?.organizations?.engagement_scope === "self_managed" ||
          itp.projects?.organizations?.engagement_scope === "client_managed";
      } else if (myParty.party_type === "subcontractor" || myParty.party_type === "main_contractor") {
        isEligibleChecklistGenerator = !!itp.projects?.allow_contractor_itp_creation;
      }
    }
  }

  const canGenerate = (session.isJagsStaff || isEligibleChecklistGenerator) && itp.status === "approved";

  return (
    <div>
      <Link href={`/inspect/itps/${itp.id}`} className="text-sm text-burgundy hover:underline">
        ← Back to ITP
      </Link>
      <div className="mt-2">
        <p className="text-sm text-muted">
          {itp.projects?.organizations?.name} · {itp.projects?.name}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-ink">
            Checklists <span className="doc-id text-lg text-muted">{itp.itp_number}</span>
          </h1>
          <PageGuide
            title="ITP checklists — how this works"
            points={[
              "Lists every checklist-type (evidence_type = 1) activity on this ITP and lets you generate its checklist once the ITP is approved — other evidence types (document upload, measurement) are handled on the ITP page itself, not here.",
              "Generating checklists is available to JAGS staff, or to the same client/contractor party eligible to create this ITP's content, once the ITP is approved — approving the ITP itself is JAGS-only for a Full-Service or Self-Managed (\"Hybrid\") client; a Full Client-Managed client's own approve_itp permission holder can approve it themselves too.",
              "Staff can start a checklist from a reusable library template instead of a blank one — only templates that are global or scoped to this ITP's own client organisation are offered.",
              "Status reflects the most recent inspection_records row for that checklist: no row = not started, a row with no result yet = in progress, a result set = complete (pass/fail/partial).",
            ]}
          />
        </div>
        <p className="mt-1 text-sm text-muted">{itp.title}</p>
      </div>

      {itp.status !== "approved" && (
        <p className="mt-6 rounded-lg border border-border bg-off-white p-4 text-sm text-muted">
          Checklists are generated once this ITP is approved. Current status:{" "}
          <Badge tone="neutral">{ITP_STATUS_LABEL[itp.status] ?? itp.status}</Badge>
        </p>
      )}

      {canGenerate && (
        <div className="mt-6">
          <GenerateChecklistsButton itpId={itp.id} />
        </div>
      )}

      <div className="mt-6 rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-4 py-2 font-medium">Item</th>
              <th className="px-4 py-2 font-medium">Activity</th>
              <th className="px-4 py-2 font-medium">Checklist</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((item) => {
              const template = templateByItem.get(item.id);
              const status = statusFor(template?.id);
              return (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="doc-id px-4 py-3 text-ink">{item.item_number}</td>
                  <td className="px-4 py-3 text-ink">{item.activity}</td>
                  <td className="px-4 py-3">
                    {template ? (
                      <span className="doc-id text-muted">{template.checklist_number}</span>
                    ) : (
                      <span className="text-muted">Not generated yet</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {template ? (
                      <Link href={`/inspect/checklists/${template.id}`} className="font-medium text-burgundy hover:underline">
                        Open →
                      </Link>
                    ) : (
                      session.isJagsStaff &&
                      libraryTemplates.length > 0 && (
                        <AttachLibraryTemplateForm itpItemId={item.id} libraryTemplates={libraryTemplates} />
                      )
                    )}
                  </td>
                </tr>
              );
            })}
            {(items ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  No checklist-type activities on this ITP.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
