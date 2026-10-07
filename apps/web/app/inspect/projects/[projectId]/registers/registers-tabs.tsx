"use client";

import { TabStrip, useUrlTab } from "@/components/ui/tabs";
import { AddCalibrationForm } from "./add-calibration-form";
import { AddWelderQualificationForm } from "./add-welder-qualification-form";
import { AddMaterialForm } from "./add-material-form";
import { AddPersonnelCertificationForm } from "./add-personnel-certification-form";
import { CalibrationTable, type CalibrationRegisterDisplayRow } from "./calibration-table";
import { WelderQualificationTable, type WelderQualificationDisplayRow } from "./welder-qualification-table";
import { MaterialTable, type MaterialRegisterDisplayRow } from "./material-table";
import { PersonnelCertificationTable, type PersonnelCertificationDisplayRow } from "./personnel-certification-table";
import { RegisterCsvTools } from "./csv-tools";
import { ExtractRegisterPanel, type ExtractState, type AddState } from "./extract-register-panel";

type GenericExtractAction = (state: ExtractState, formData: FormData) => Promise<ExtractState>;
type GenericAddAction = (state: AddState, formData: FormData) => Promise<AddState>;

const TABS = [
  { key: "calibration", label: "Calibration" },
  { key: "welder", label: "Welder Qualification" },
  { key: "material", label: "Material" },
  { key: "personnel", label: "Personnel Certifications" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * All 4 project registers (plan Phase 9) reuse the same "expiring-soon tracking" table shape — they
 * previously rendered as 4 stacked full sections on one long-scrolling page. Folded into tabs of one
 * hub instead: same data, same add/extract forms per register, just one register visible at a time
 * so switching between them doesn't mean scrolling past three others' worth of content.
 */
export function RegistersTabs({
  projectId,
  canAdd,
  canManage,
  calibrationRows,
  welderRows,
  materialRows,
  personnelCertRows,
  projectParties,
  partyMembers,
  extractCalibrationRowsAction,
  addExtractedCalibrationRowsAction,
  extractWelderRowsAction,
  addExtractedWelderRowsAction,
  extractMaterialRowsAction,
  addExtractedMaterialRowsAction,
}: {
  projectId: string;
  /** May add entries (JAGS staff + contractor/subcontractor/TPI parties). */
  canAdd: boolean;
  /** May edit, release and delete (JAGS staff). */
  canManage: boolean;
  calibrationRows: CalibrationRegisterDisplayRow[];
  welderRows: WelderQualificationDisplayRow[];
  materialRows: MaterialRegisterDisplayRow[];
  personnelCertRows: PersonnelCertificationDisplayRow[];
  projectParties: { id: string; name: string }[];
  partyMembers: { user_id: string; party_id: string; party_name: string; name: string }[];
  extractCalibrationRowsAction: GenericExtractAction;
  addExtractedCalibrationRowsAction: GenericAddAction;
  extractWelderRowsAction: GenericExtractAction;
  addExtractedWelderRowsAction: GenericAddAction;
  extractMaterialRowsAction: GenericExtractAction;
  addExtractedMaterialRowsAction: GenericAddAction;
}) {
  const [activeTab, setActiveTab] = useUrlTab<TabKey>("reg", TABS.map((t) => t.key));

  return (
    <div className="mt-8">
      <TabStrip tabs={TABS} active={activeTab} onSelect={setActiveTab} label="Project registers" idPrefix="register" />

      <div className="mt-4" role="tabpanel" id={`register-panel-${activeTab}`} aria-labelledby={`register-${activeTab}`}>
        {activeTab === "calibration" && (
          <section>
            {canAdd && (
              <div className="mt-3">
                <AddCalibrationForm projectId={projectId} />
              </div>
            )}
            {canAdd && <ExtractRegisterPanel
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
              extractAction={extractCalibrationRowsAction}
              addAction={addExtractedCalibrationRowsAction}
            />}
            <div className="mt-3">
              <RegisterCsvTools projectId={projectId} kind="calibration" canAdd={canAdd} />
              <CalibrationTable rows={calibrationRows} projectId={projectId} canManage={canManage} />
            </div>
          </section>
        )}

        {activeTab === "welder" && (
          <section>
            {canAdd && (
              <div className="mt-3">
                <AddWelderQualificationForm projectId={projectId} />
              </div>
            )}
            {canAdd && <ExtractRegisterPanel
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
              extractAction={extractWelderRowsAction}
              addAction={addExtractedWelderRowsAction}
            />}
            <div className="mt-3">
              <RegisterCsvTools projectId={projectId} kind="welder" canAdd={canAdd} />
              <WelderQualificationTable rows={welderRows} projectId={projectId} canManage={canManage} />
            </div>
          </section>
        )}

        {activeTab === "material" && (
          <section>
            {canAdd && (
              <div className="mt-3">
                <AddMaterialForm projectId={projectId} isStaff={canManage} />
              </div>
            )}
            {canAdd && <ExtractRegisterPanel
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
              extractAction={extractMaterialRowsAction}
              addAction={addExtractedMaterialRowsAction}
            />}
            <div className="mt-3">
              <RegisterCsvTools projectId={projectId} kind="material" canAdd={canAdd} />
              <MaterialTable rows={materialRows} projectId={projectId} canManage={canManage} />
            </div>
          </section>
        )}

        {activeTab === "personnel" && (
          <section>
            <p className="mt-1 text-sm text-muted">
              Whether the person performing/signing off an inspection holds a current qualification for
              that activity type (e.g. AWS CWI, ASNT NDT Level II, CSWIP 3.1).
            </p>
            {canAdd && (
              <div className="mt-3">
                <AddPersonnelCertificationForm projectId={projectId} projectParties={projectParties} partyMembers={partyMembers} />
              </div>
            )}
            <div className="mt-3">
              <RegisterCsvTools projectId={projectId} kind="personnel" canAdd={canAdd} />
              <PersonnelCertificationTable rows={personnelCertRows} projectId={projectId} canManage={canManage} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
