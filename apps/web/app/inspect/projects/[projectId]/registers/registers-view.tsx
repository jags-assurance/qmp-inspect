import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { isModuleLicensed } from "@/lib/module-licensing/access";
import { refreshRegisterStatuses } from "@/lib/registers/refresh";
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

  await refreshRegisterStatuses(supabase, projectId);

  const [{ data: calibrationRows }, { data: welderRows }, { data: materialRows }, { data: personnelCertRows }, { data: projectParties }] =
    await Promise.all([
      supabase
        .from(CALIBRATION_REGISTER_TABLE)
        .select("id, instrument_name, cert_number, cal_date, due_date, status, notes")
        .eq("project_id", projectId)
        .order("due_date")
        .returns<CalibrationRegisterDisplayRow[]>(),
      supabase
        .from(WELDER_QUALIFICATION_REGISTER_TABLE)
        .select("id, welder_identifier, qualified_wps, qualified_ranges, expiry_date, status, notes")
        .eq("project_id", projectId)
        .order("expiry_date")
        .returns<WelderQualificationDisplayRow[]>(),
      supabase
        .from(MATERIAL_REGISTER_TABLE)
        .select(
          "id, material_description, submittal_reference, approval_status, approved_date, heat_number, batch_number, po_reference, certificate_reference, receipt_status, disposition_notes, notes"
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .returns<MaterialRegisterDisplayRow[]>(),
      supabase
        .from(PERSONNEL_CERTIFICATIONS_TABLE)
        .select("id, certification_type, cert_number, issued_date, expiry_date, status, notes, project_parties(name)")
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

  const Heading = embedded ? "h2" : "h1";
  return (
    <div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Heading className="doc-id text-2xl font-semibold text-ink">{project.project_number} — Registers</Heading>
          <PageGuide
            title="Registers — how this works"
            points={[
              "Calibration, welder qualification, material approval and personnel certification records that ITP field execution auto-verifies against.",
              "Each status (valid/expiring/expired) is recomputed against today's date every time this page loads, not on a schedule — so it's never stale.",
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

      <RegistersTabs
        projectId={projectId}
        calibrationRows={calibrationRows ?? []}
        welderRows={welderRows ?? []}
        materialRows={materialRows ?? []}
        personnelCertRows={personnelCertRows ?? []}
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
