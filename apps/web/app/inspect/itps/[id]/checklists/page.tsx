import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { CHECKLIST_TEMPLATES_TABLE, type ChecklistTemplateRow } from "@/lib/checklists/db-types";
import { GenerateChecklistsButton } from "./generate-button";
import { ITP_STATUS_LABEL } from "../../itps-table";

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
      "id, itp_number, title, status, project_id, projects(name, allow_client_itp_creation, allow_contractor_itp_creation, organizations(name, engagement_scope))"
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
          !!itp.projects?.allow_client_itp_creation || itp.projects?.organizations?.engagement_scope === "self_managed";
      } else if (myParty.party_type === "subcontractor" || myParty.party_type === "main_contractor") {
        isEligibleChecklistGenerator = !!itp.projects?.allow_contractor_itp_creation;
      }
    }
  }

  const canGenerate = (session.isJagsStaff || isEligibleChecklistGenerator) && itp.status === "approved";

  return (
    <div>
      <div>
        <p className="text-sm text-muted">
          {itp.projects?.organizations?.name} · {itp.projects?.name}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">
          Checklists <span className="doc-id text-lg text-muted">{itp.itp_number}</span>
        </h1>
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
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((item) => {
              const template = templateByItem.get(item.id);
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
                  <td className="px-4 py-3 text-right">
                    {template && (
                      <Link href={`/inspect/checklists/${template.id}`} className="font-medium text-burgundy hover:underline">
                        Open →
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {(items ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted">
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
