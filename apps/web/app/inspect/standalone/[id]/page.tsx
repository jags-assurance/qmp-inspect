import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import type {
  AssignmentConclusion,
  AssignmentStatus,
  AssignmentType,
  StandaloneAssignmentMeasurementRow,
  StandaloneAssignmentPhotoRow,
  StandaloneAssignmentPunchItemRow,
  StandaloneAssignmentSignatureRow,
} from "@/lib/standalone/actions";
import { AssignmentWorkspace } from "./assignment-workspace";

interface AssignmentDetail {
  id: string;
  project_id: string;
  assignment_number: string;
  assignment_type: AssignmentType;
  equipment_description: string;
  manufacturer: string | null;
  model: string | null;
  serial_tag: string | null;
  location: string | null;
  standard_reference: string | null;
  assignment_date: string | null;
  status: AssignmentStatus;
  conclusion: AssignmentConclusion | null;
  notes: string | null;
  projects: { id: string; name: string; organizations: { name: string } | null } | null;
}

const TYPE_LABEL: Record<AssignmentType, string> = {
  fat: "FAT",
  witness_inspection: "Witness Inspection",
  specific_test: "Specific Test",
  pre_shipment: "Pre-Shipment",
};

const TYPE_TONE: Record<AssignmentType, "gold" | "info" | "neutral" | "warning"> = {
  fat: "gold",
  witness_inspection: "info",
  specific_test: "neutral",
  pre_shipment: "warning",
};

export default async function StandaloneAssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: assignment } = await supabase
    .from("standalone_assignments" as any)
    .select("*, projects(id, name, organizations(name))")
    .eq("id", id)
    .maybeSingle<AssignmentDetail>();

  if (!assignment) notFound();

  const [{ data: measurements }, { data: photos }, { data: punchItems }, { data: signatures }] =
    await Promise.all([
      supabase
        .from("standalone_assignment_measurements" as any)
        .select("*")
        .eq("assignment_id", id)
        .order("sort_order")
        .returns<StandaloneAssignmentMeasurementRow[]>(),
      supabase
        .from("standalone_assignment_photos" as any)
        .select("*")
        .eq("assignment_id", id)
        .order("created_at")
        .returns<StandaloneAssignmentPhotoRow[]>(),
      supabase
        .from("standalone_assignment_punch_items" as any)
        .select("*")
        .eq("assignment_id", id)
        .order("created_at")
        .returns<StandaloneAssignmentPunchItemRow[]>(),
      supabase
        .from("standalone_assignment_signatures" as any)
        .select("*")
        .eq("assignment_id", id)
        .order("signed_at")
        .returns<StandaloneAssignmentSignatureRow[]>(),
    ]);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="doc-id text-2xl font-semibold text-ink">{assignment.assignment_number}</h1>
            <Badge tone={TYPE_TONE[assignment.assignment_type]}>{TYPE_LABEL[assignment.assignment_type]}</Badge>
          </div>
          <p className="mt-1 text-lg text-ink">{assignment.equipment_description}</p>
          <p className="mt-1 text-sm text-muted">
            {assignment.projects?.organizations?.name} · {assignment.projects?.name}
            {assignment.standard_reference ? ` · ${assignment.standard_reference}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-8">
        <AssignmentWorkspace
          assignment={assignment}
          measurements={measurements ?? []}
          photos={photos ?? []}
          punchItems={punchItems ?? []}
          signatures={signatures ?? []}
        />
      </div>
    </div>
  );
}
