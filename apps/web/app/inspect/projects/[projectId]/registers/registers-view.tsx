import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { isModuleLicensed } from "@/lib/module-licensing/access";
import { refreshRegisterStatuses } from "@/lib/registers/refresh";
import { getRegisterAccess } from "@/lib/registers/permissions";
import { computeCalibrationStatus, computePersonnelCertificationStatus, computeWelderStatus, daysUntil } from "@/lib/registers/status";
import {
  CALIBRATION_REGISTER_TABLE,
  MATERIAL_REGISTER_TABLE,
  WELDER_QUALIFICATION_REGISTER_TABLE,
  PERSONNEL_CERTIFICATIONS_TABLE,
} from "@/lib/registers/types";
import type { CalibrationRegisterDisplayRow } from "./calibration-table";
import type { WelderQualificationDisplayRow } from "./welder-qualification-table";
import type { MaterialRegisterDisplayRow } from "./material-table";
import type { PersonnelCertificationDisplayRow } from "./personnel-certification-table";
import type { ExtractState, AddState } from "./extract-register-panel";
import { RegistersTabs } from "./registers-tabs";
import {
  extractCalibrationRowsAction,
  addExtractedCalibrationRowsAction,
  extractWelderRowsAction,
  addExtractedWelderRowsAction,
  extractMaterialRowsAction,
  addExtractedMaterialRowsAction,
} from "@/lib/registers/actions";
import { PageGuide } from "@/components/domain/page-guide";

// The three extract*Action/addExtracted*RowsAction pairs are typed against their own specific row
// shapes (ExtractedCalibrationRow, etc.) for type safety inside lib/registers/actions.ts, but
// ExtractRegisterPanel is intentionally generic over a flat Record<string, string | null> row (see
// its own doc comment) since all three shapes really are just that at the UI-editing layer. The
// cast here is the one place that gap is bridged — each action's actual runtime behavior already
// matches (same field names, just typed more loosely on the panel's side).
type GenericExtractAction = (state: ExtractState, formData: FormData) => Promise<ExtractState>;
type GenericAddAction = (state: AddState, formData: FormData) => Promise<AddState>;

/**
 * Project-level registers (Reqs R92-R100): calibration, welder qualification, and material
 * approval records that ITP field execution checks against (see lib/registers/verify.ts). Statuses
 * are refreshed from today's date before every read — see lib/registers/refresh.ts for why that's
 * a read-time recompute rather than a scheduled job.
 */
export async function RegistersView({ projectId, embedded = false }: { projectId: string; embedded?: boolean }) {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number, organization_id, organizations(name)")
    .eq("id", projectId)
    .maybeSingle<{ id: string; name: string; project_number: string; organization_id: string; organizations: { name: string } | null }>();

  if (!project) notFound();

  // R112 module licensing (page-level — see reports/page.tsx's doc comment for why: no single org
  // to gate at the shared /inspect layout). JAGS staff always bypass.
  if (!session.isJagsStaff && !(await isModuleLicensed(supabase, project.organization_id, "registers"))) {
    redirect(`/inspect/projects/${projectId}`);
  }

  const access = await getRegisterAccess(supabase, session, projectId);
  // Keep the stored statuses fresh when staff open the page; everyone sees statuses recomputed from
  // the dates below either way, so a read-only viewer is never shown a stale "valid".
  if (access.canManage) await refreshRegisterStatuses(supabase, projectId);

  const [{ data: calibrationRows }, { data: welderRows }, { data: materialRows }, { data: personnelCertRows }, { data: projectParties }] =
    await Promise.all([
      supabase
        .from(CALIBRATION_REGISTER_TABLE)
        .select("id, instrument_name, instrument_tag, calibration_lab, cert_number, cal_date, due_date, status, certificate_path, notes")
        .eq("project_id", projectId)
        .order("due_date")
        .returns<CalibrationRegisterDisplayRow[]>(),
      supabase
        .from(WELDER_QUALIFICATION_REGISTER_TABLE)
        .select("id, welder_identifier, wpq_number, process, position, qualified_wps, qualified_ranges, expiry_date, status, certificate_path, notes")
        .eq("project_id", projectId)
        .order("expiry_date")
        .returns<WelderQualificationDisplayRow[]>(),
      supabase
        .from(MATERIAL_REGISTER_TABLE)
        .select(
          "id, material_description, submittal_reference, approval_status, approved_date, heat_number, batch_number, po_reference, supplier, quantity, certificate_reference, certificate_path, receipt_status, disposition_notes, released_at, notes"
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .returns<MaterialRegisterDisplayRow[]>(),
      supabase
        .from(PERSONNEL_CERTIFICATIONS_TABLE)
        .select("id, certification_type, cert_number, issued_date, expiry_date, status, certificate_path, notes, project_parties(name)")
        .eq("project_id", projectId)
        .order("expiry_date")
        .returns<PersonnelCertificationDisplayRow[]>(),
      supabase
        .from("project_parties")
        .select("id, name")
        .eq("project_id", projectId)
        .eq("is_active", true)
        .order("name")
        .returns<{ id: string; name: string }[]>(),
    ]);

  // Statuses recomputed from the dates (never trust a stored value that may not have been refreshed).
  const calibrationList = (calibrationRows ?? []).map((r) => ({ ...r, status: computeCalibrationStatus(r.due_date) }));
  const welderList = (welderRows ?? []).map((r) => ({ ...r, status: computeWelderStatus(r.expiry_date) }));
  const personnelList = (personnelCertRows ?? []).map((r) => ({ ...r, status: computePersonnelCertificationStatus(r.expiry_date) }));
  const materialList = materialRows ?? [];

  const attention = [
    { label: "calibration expired", count: calibrationList.filter((r) => r.status === "expired").length, tone: "danger" as const },
    { label: "welder qualification expired", count: welderList.filter((r) => r.status === "expired").length, tone: "danger" as const },
    { label: "personnel certification expired", count: personnelList.filter((r) => r.status === "expired").length, tone: "danger" as const },
    { label: "due or expiring soon", count: [...calibrationList.filter((r) => r.status === "due_soon"), ...welderList.filter((r) => r.status === "expiring"), ...personnelList.filter((r) => r.status === "expiring_soon")].length, tone: "warning" as const },
    { label: "material awaiting receiving inspection or on hold", count: materialList.filter((r) => r.receipt_status !== "released").length, tone: "warning" as const },
  ].filter((a) => a.count > 0);
  const nextDue = [
    ...calibrationList.map((r) => ({ what: r.instrument_name, date: r.due_date })),
    ...welderList.map((r) => ({ what: r.welder_identifier, date: r.expiry_date })),
    ...personnelList.map((r) => ({ what: r.certification_type, date: r.expiry_date })),
  ]
    .filter((r) => daysUntil(r.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  const Heading = embedded ? "h2" : "h1";
  return (
    <div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Heading className="doc-id text-2xl font-semibold text-ink">{embedded ? "Registers" : `${project.project_number} — Registers`}</Heading>
          <PageGuide
            title="Registers — how this works"
            points={[
              "Calibration, welder qualification, material approval and personnel certification records that ITP field execution auto-verifies against.",
              "Each status (valid / due soon / expired) is worked out from the entry's date every time it is shown, so it is never stale. Calibration warns 30 days ahead; welder and personnel certificates 90 days ahead.",
              "Who can do what: JAGS staff add, edit, release and delete; the project's contractor, subcontractor and TPI/lab parties can add entries (a contractor-added material starts as 'received — pending inspection' until JAGS staff release it); everyone else can view.",
              "This page requires the project's organisation to be licensed for the Registers module (JAGS staff always bypass) — otherwise it redirects back to the project hub.",
              "The \"Extract\" panel on each register reads free text (e.g. a pasted certificate) and proposes rows to add — it never sets an approval/release status itself; a material's disposition still needs a person to decide it.",
            ]}
          />
        </div>
        <p className="mt-1 text-sm text-muted">
          {project.organizations?.name} · {project.name}. These feed the auto-verification shown when inspecting
          related ITP activities.
        </p>
      </div>

      {attention.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm" role="status">
          <span className="font-medium text-ink">Needs attention:</span>
          {attention.map((a) => (
            <span
              key={a.label}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${a.tone === "danger" ? "bg-danger/10 text-danger" : "bg-warning/15 text-ink"}`}
            >
              {a.count} {a.label}
            </span>
          ))}
          <span className="text-xs text-muted">These hold up the Data Book until they are renewed, replaced or released.</span>
        </div>
      ) : (
        <p className="mt-4 text-sm text-success" role="status">
          Everything in the registers is currently valid{nextDue ? ` — next date to watch: ${nextDue.what} on ${new Date(nextDue.date).toLocaleDateString("en-GB")}` : ""}.
        </p>
      )}
      {!access.canAdd && (
        <p className="mt-3 rounded-md bg-off-white px-3 py-2 text-xs text-muted">
          You can view these registers. Only JAGS staff and this project&apos;s contractor, subcontractor and TPI/lab parties can add entries; only JAGS staff can edit or release them.
        </p>
      )}

      <RegistersTabs
        projectId={projectId}
        canAdd={access.canAdd}
        canManage={access.canManage}
        calibrationRows={calibrationList}
        welderRows={welderList}
        materialRows={materialList}
        personnelCertRows={personnelList}
        projectParties={projectParties ?? []}
        extractCalibrationRowsAction={extractCalibrationRowsAction as unknown as GenericExtractAction}
        addExtractedCalibrationRowsAction={addExtractedCalibrationRowsAction as unknown as GenericAddAction}
        extractWelderRowsAction={extractWelderRowsAction as unknown as GenericExtractAction}
        addExtractedWelderRowsAction={addExtractedWelderRowsAction as unknown as GenericAddAction}
        extractMaterialRowsAction={extractMaterialRowsAction as unknown as GenericExtractAction}
        addExtractedMaterialRowsAction={addExtractedMaterialRowsAction as unknown as GenericAddAction}
      />
    </div>
  );
}
