import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { refreshRegisterStatuses } from "@/lib/registers/refresh";
import {
  CALIBRATION_REGISTER_TABLE,
  MATERIAL_REGISTER_TABLE,
  WELDER_QUALIFICATION_REGISTER_TABLE,
} from "@/lib/registers/types";
import { AddCalibrationForm } from "./add-calibration-form";
import { AddWelderQualificationForm } from "./add-welder-qualification-form";
import { AddMaterialForm } from "./add-material-form";
import { CalibrationTable, type CalibrationRegisterDisplayRow } from "./calibration-table";
import { WelderQualificationTable, type WelderQualificationDisplayRow } from "./welder-qualification-table";
import { MaterialTable, type MaterialRegisterDisplayRow } from "./material-table";

/**
 * Project-level registers (Reqs R92-R100): calibration, welder qualification, and material
 * approval records that ITP field execution checks against (see lib/registers/verify.ts). Statuses
 * are refreshed from today's date before every read — see lib/registers/refresh.ts for why that's
 * a read-time recompute rather than a scheduled job.
 */
export default async function RegistersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number, organizations(name)")
    .eq("id", projectId)
    .maybeSingle<{ id: string; name: string; project_number: string; organizations: { name: string } | null }>();

  if (!project) notFound();

  await refreshRegisterStatuses(supabase, projectId);

  const [{ data: calibrationRows }, { data: welderRows }, { data: materialRows }] = await Promise.all([
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
      .select("id, material_description, submittal_reference, approval_status, approved_date, notes")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .returns<MaterialRegisterDisplayRow[]>(),
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
        <div className="mt-3">
          <CalibrationTable rows={calibrationRows ?? []} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium text-ink">Welder Qualification Register</h2>
        <div className="mt-3">
          <AddWelderQualificationForm projectId={projectId} />
        </div>
        <div className="mt-3">
          <WelderQualificationTable rows={welderRows ?? []} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium text-ink">Material Register</h2>
        <div className="mt-3">
          <AddMaterialForm projectId={projectId} />
        </div>
        <div className="mt-3">
          <MaterialTable rows={materialRows ?? []} />
        </div>
      </section>
    </div>
  );
}
