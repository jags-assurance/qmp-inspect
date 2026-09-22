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
import { AddCalibrationForm } from "./add-calibration-form";
import { AddWelderQualificationForm } from "./add-welder-qualification-form";
import { AddMaterialForm } from "./add-material-form";
import { AddPersonnelCertificationForm } from "./add-personnel-certification-form";
import { CalibrationTable, type CalibrationRegisterDisplayRow } from "./calibration-table";
import { WelderQualificationTable, type WelderQualificationDisplayRow } from "./welder-qualification-table";
import { MaterialTable, type MaterialRegisterDisplayRow } from "./material-table";
import { PersonnelCertificationTable, type PersonnelCertificationDisplayRow } from "./personnel-certification-table";
import { ExtractRegisterPanel, type ExtractState, type AddState } from "./extract-register-panel";
import {
  extractCalibrationRowsAction,
  addExtractedCalibrationRowsAction,
  extractWelderRowsAction,
  addExtractedWelderRowsAction,
  extractMaterialRowsAction,
  addExtractedMaterialRowsAction,
} from "@/lib/registers/actions";

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
export default async function RegistersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
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

  return (
    <div>
      <div>
        <h1 className="doc-id text-2xl font-semibold text-ink">{project.project_number} — Registers</h1>
        <p className="mt-1 text-sm text-muted">
          {project.organizations?.name} · {project.name}. These feed the auto-verification shown when inspecting
          related ITP activities.
        </p>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-medium text-ink">Calibration Register</h2>
        <div className="mt-3">
          <AddCalibrationForm projectId={projectId} />
        </div>
        <ExtractRegisterPanel
          projectId={projectId}
          title="Calibration Register"
          description="Extract instrument, certificate number, calibration date and due date from calibration certificate text."
          placeholder={"e.g. \"Instrument: Megger MIT430 insulation tester. Certificate CAL-2291. Calibrated 14 Mar 2026. Next due 13 Mar 2027.\""}
          fields={[
            { key: "instrumentName", label: "Instrument" },
            { key: "certNumber", label: "Cert no." },
            { key: "calDate", label: "Cal. date" },
            { key: "dueDate", label: "Due date" },
          ]}
          extractAction={extractCalibrationRowsAction as unknown as GenericExtractAction}
          addAction={addExtractedCalibrationRowsAction as unknown as GenericAddAction}
        />
        <div className="mt-3">
          <CalibrationTable rows={calibrationRows ?? []} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium text-ink">Welder Qualification Register</h2>
        <div className="mt-3">
          <AddWelderQualificationForm projectId={projectId} />
        </div>
        <ExtractRegisterPanel
          projectId={projectId}
          title="Welder Qualification Register"
          description="Extract welder ID, process/position, qualified range and expiry from WPQ (welder performance qualification) text. A range or continuity record not confirmed in the source stays flagged as unconfirmed, never guessed."
          placeholder={"e.g. \"Welder: M. Rahman. ID W-014. Process GTAW/SMAW. Position 6G. Record WPQ-014. Continuity log not attached.\""}
          fields={[
            { key: "welderIdentifier", label: "Welder ID" },
            { key: "qualifiedWps", label: "Process / position" },
            { key: "qualifiedRanges", label: "Range / continuity" },
            { key: "expiryDate", label: "Expiry date" },
          ]}
          extractAction={extractWelderRowsAction as unknown as GenericExtractAction}
          addAction={addExtractedWelderRowsAction as unknown as GenericAddAction}
        />
        <div className="mt-3">
          <WelderQualificationTable rows={welderRows ?? []} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium text-ink">Material Register</h2>
        <div className="mt-3">
          <AddMaterialForm projectId={projectId} />
        </div>
        <ExtractRegisterPanel
          projectId={projectId}
          title="Material Register"
          description="Extract material description, submittal reference, heat/batch number and certificate reference from a submittal or certificate. Added rows land quarantined pending disposition — extraction never sets a release status; that stays a document-controller decision."
          placeholder={"e.g. \"LV cable 0.6/1 kV, batch CB-084. Certificate of Conformity CoC-1884. Approved submittal MS-071 Rev 2.\""}
          fields={[
            { key: "materialDescription", label: "Material" },
            { key: "submittalReference", label: "Submittal ref." },
            { key: "heatNumber", label: "Heat no." },
            { key: "batchNumber", label: "Batch no." },
            { key: "poReference", label: "PO ref." },
            { key: "certificateReference", label: "CoC / MTC ref." },
          ]}
          extractAction={extractMaterialRowsAction as unknown as GenericExtractAction}
          addAction={addExtractedMaterialRowsAction as unknown as GenericAddAction}
        />
        <div className="mt-3">
          <MaterialTable rows={materialRows ?? []} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium text-ink">Personnel Certifications</h2>
        <p className="mt-1 text-sm text-muted">
          Whether the person performing/signing off an inspection holds a current qualification for
          that activity type (e.g. AWS CWI, ASNT NDT Level II, CSWIP 3.1).
        </p>
        <div className="mt-3">
          <AddPersonnelCertificationForm projectId={projectId} projectParties={projectParties ?? []} />
        </div>
        <div className="mt-3">
          <PersonnelCertificationTable rows={personnelCertRows ?? []} />
        </div>
      </section>
    </div>
  );
}
