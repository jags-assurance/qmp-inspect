"use client";

import { useActionState, useState } from "react";
import {
  createItpFromDraftAction,
  generateItpDraftAction,
  type CreateItpFromDraftState,
  type GenerateItpDraftState,
} from "@/lib/itps/ai-draft-actions";
import type { ItpDraftResult } from "@/lib/ai/provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form-field";
import { FormMessage } from "@/components/ui/form-message";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useActiveProjectDefault } from "@/lib/projects/use-active-project-default";

const EXTRACTION_LABEL: Record<string, string> = {
  done: "Ready",
  pending: "Processing…",
  empty: "No text found",
  unsupported: "File type not supported",
  failed: "Could not be read",
};

const createInitialState: CreateItpFromDraftState = { error: null };
const genInitialState: GenerateItpDraftState = {
  error: null,
  draft: null,
  projectParties: [],
  interventionLevels: [],
  aiLogId: null,
  suggestedItpNumber: null,
};

type CountMode = "auto" | "concise" | "standard" | "detailed" | "custom";

const COUNT_MODE_OPTIONS: { value: CountMode; label: string; hint: string }[] = [
  { value: "auto", label: "Let AI decide", hint: "Whatever the source material naturally supports." },
  { value: "concise", label: "Concise", hint: "~1–2 activities per section — the critical points only." },
  { value: "standard", label: "Standard", hint: "~3–4 activities per section — typical level of detail." },
  { value: "detailed", label: "Detailed", hint: "~5–7 activities per section — as thorough as the source allows." },
  { value: "custom", label: "Custom", hint: "Set an exact target number per section." },
];

/** Builds the extra instruction line the count control adds on top of the user's own free text. */
function countInstructionFor(mode: CountMode, customCount: string): string {
  switch (mode) {
    case "concise":
      return "Keep each section concise — aim for roughly 1-2 activities per section, covering only the most critical checks.";
    case "standard":
      return "Aim for a standard level of detail — roughly 3-4 activities per section.";
    case "detailed":
      return "Be thorough — aim for roughly 5-7 activities per section, covering as many distinct checks or tests as the source material supports.";
    case "custom": {
      const n = Number(customCount);
      return n > 0 ? `Aim for approximately ${n} activities in each section.` : "";
    }
    case "auto":
    default:
      return "";
  }
}

/** A vault document this user can pick as real source material for generation. */
export interface VaultDocumentOption {
  id: string;
  projectId: string;
  folderName: string;
  title: string;
  notes: string | null;
  documentNumber: string | null;
  documentReference: string | null;
  revision: string;
  /** 'pending' | 'done' | 'empty' | 'unsupported' | 'failed' — only 'done' has usable extracted text. */
  extractionStatus: string;
}

/**
 * Third "start an ITP" option: pick the actual requirement documents attached in this project's
 * vault (specs, standards, method statements — whatever covers the disciplines involved), get an
 * AI-generated draft grounded in their real text back, review and edit every field, optionally
 * regenerate with feedback, then confirm. Nothing is written to the database until the final
 * "Create ITP from this draft" submit — the draft returned by generateItpDraftAction is held only
 * in this component's local state (mirrored into an editable copy) until then.
 */
export function NewItpFromAiForm({
  projects,
  vaultDocuments,
  disciplines,
}: {
  projects: { id: string; project_number: string; name: string }[];
  vaultDocuments: VaultDocumentOption[];
  disciplines: { code: string; name: string }[];
}) {
  const tl = useTranslate();
  const [genState, genFormAction, genPending] = useActionState(generateItpDraftAction, genInitialState);
  const [draft, setDraft] = useState<ItpDraftResult | null>(null);
  const [projectParties, setProjectParties] = useState<GenerateItpDraftState["projectParties"]>([]);
  const [interventionLevels, setInterventionLevels] = useState<GenerateItpDraftState["interventionLevels"]>([]);
  const [aiLogId, setAiLogId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  useActiveProjectDefault(projects.map((p) => p.id), projectId, setProjectId);
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [feedback, setFeedback] = useState("");
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [countMode, setCountMode] = useState<CountMode>("auto");
  const [customCount, setCustomCount] = useState("4");
  const [itpNumber, setItpNumber] = useState("");
  const [title, setTitle] = useState("");
  const [applicableStandard, setApplicableStandard] = useState("");

  const projectVaultDocuments = vaultDocuments.filter((d) => d.projectId === projectId);
  const disciplineNameByCode = new Map(disciplines.map((d) => [d.code, d.name]));

  function toggleDoc(docId: string) {
    setSelectedDocIds((ids) => (ids.includes(docId) ? ids.filter((id) => id !== docId) : [...ids, docId]));
  }

  function combinedInstructions(extra?: string): string {
    const countLine = countInstructionFor(countMode, customCount);
    return [countLine, additionalInstructions, extra].filter(Boolean).join("\n\n");
  }

  // Derives the editable draft copy from a fresh generateItpDraftAction result during render
  // (React's documented "adjust state while rendering" pattern) rather than in a useEffect — this
  // avoids the extra commit-then-effect render pass for what is really just "seed local state from
  // a new action result". Also covers the "regenerate with feedback" case below, which reuses the
  // same genFormAction and simply overwrites the local draft with the new result.
  const [appliedGenState, setAppliedGenState] = useState(genState);
  if (genState !== appliedGenState) {
    setAppliedGenState(genState);
    if (genState.draft) {
      setDraft(genState.draft);
      setProjectParties(genState.projectParties);
      setInterventionLevels(genState.interventionLevels);
      setAiLogId(genState.aiLogId);
      setFeedback("");
      // Auto-fill from the AI's suggestions, but never clobber something the user already typed —
      // a "regenerate with feedback" cycle keeps whatever the reviewer already customized.
      setItpNumber((prev) => prev || genState.suggestedItpNumber || "");
      setTitle((prev) => prev || genState.draft?.suggestedTitle || "");
      setApplicableStandard((prev) => prev || genState.draft?.suggestedApplicableStandard || "");
    }
  }

  const [createState, createFormAction, createPending] = useActionState(
    createItpFromDraftAction,
    createInitialState
  );

  if (!draft) {
    return (
      <form action={genFormAction} className="mt-6 space-y-5 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
        <div>
          <FormField required label="Project">
            <select
            name="project_id"
            required
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setSelectedDocIds([]);
            }}
            className="mt-1.5 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
          >
            <option value=""><Tx>Select…</Tx></option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_number} — {p.name}
              </option>
            ))}
          </select>
          </FormField>
        </div>

        {projectId && (
          <div>
            <p className="block text-sm font-semibold text-ink"><Tx>Requirement documents from the vault</Tx></p>
            <p className="mt-1 text-xs text-muted">
              <Tx>Pick everything relevant — specs, standards, method statements, drawings notes. The AI reads their actual text and covers every discipline they touch in one draft.</Tx>
            </p>
            {projectVaultDocuments.length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed border-border bg-surface-subtle p-3 text-xs text-muted">
                <Tx>No documents in this project&apos;s vault yet — upload specs/standards under Document Vault first, or describe the scope below instead.</Tx>
              </p>
            ) : (
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {projectVaultDocuments.map((doc) => {
                  const usable = doc.extractionStatus === "done";
                  return (
                    <li key={doc.id} className="flex items-start gap-2 rounded px-1.5 py-1.5 hover:bg-surface-subtle">
                      <input
                        type="checkbox"
                        id={`doc_${doc.id}`}
                        name="vault_document_ids"
                        value={doc.id}
                        checked={selectedDocIds.includes(doc.id)}
                        onChange={() => toggleDoc(doc.id)}
                        disabled={!usable}
                        className="mt-0.5"
                      />
                      <label htmlFor={`doc_${doc.id}`} className="flex-1 text-sm">
                        <span className={usable ? "text-ink" : "text-muted"}>
                          {doc.documentNumber ? `${doc.documentNumber} — ` : ""}
                          {doc.title}
                        </span>
                        <span className="ms-2 text-xs text-muted">
                          {doc.folderName} <Tx>· rev</Tx> {doc.revision} ·{" "}
                          <span className={usable ? "text-success" : "text-muted"}>
                            {EXTRACTION_LABEL[doc.extractionStatus] ?? doc.extractionStatus}
                          </span>
                        </span>
                        {doc.extractionStatus === "unsupported" && (
                          <span className="mt-0.5 block text-xs text-muted">
                            <Tx>Only PDF, Word (.docx), or plain text/.md can be read for AI generation — re-upload this document as one of those to use it here.</Tx>
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div>
          <p className="block text-sm font-semibold text-ink"><Tx>Activities per section</Tx></p>
          <p className="mt-1 text-xs text-muted">
            <Tx>How thorough each of the 4 sections should be — the AI still decides exactly which checks matter most, this just sets the target depth.</Tx>
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {COUNT_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setCountMode(opt.value)}
                title={opt.hint}
                className={`rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                  countMode === opt.value
                    ? "border-burgundy bg-burgundy text-white"
                    : "border-border bg-surface text-ink hover:bg-surface-subtle"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {COUNT_MODE_OPTIONS.find((o) => o.value === countMode)?.hint}
          </p>
          {countMode === "custom" && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={20}
                value={customCount}
                onChange={(e) => setCustomCount(e.target.value)}
                className="w-24 min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
              />
              <span className="text-xs text-muted"><Tx>activities per section</Tx></span>
            </div>
          )}
        </div>

        <div>
          <label htmlFor="additional_instructions_visible" className="block text-sm font-semibold text-ink">
            <Tx>Additional instructions</Tx> <span className="font-normal text-muted"><Tx>(optional)</Tx></span>
          </label>
          <textarea
            id="additional_instructions_visible"
            rows={4}
            value={additionalInstructions}
            onChange={(e) => setAdditionalInstructions(e.target.value)}
            placeholder="Anything the documents don't cover, or a focus to apply — e.g. &quot;electrical works only&quot;, or paste extra scope text if you have no document to attach."
            className="mt-1.5 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
          />
          {/* Combines the count-mode instruction with the user's free text into the one field the
              server action actually reads — keeps the count control a first-class UI element instead
              of asking the user to type it themselves. */}
          <input type="hidden" name="additional_instructions" value={combinedInstructions()} />
          <p className="mt-1.5 text-xs text-muted">
            <Tx>The AI drafts sections, activities, references, acceptance criteria and suggested intervention levels per party for you to review and edit below — nothing is created until you confirm.</Tx>
          </p>
        </div>

        <FormMessage error={genState.error} />

        <StickyActionBar inCard>
          <Button type="submit" disabled={genPending}>
            {genPending ? "Generating…" : "Generate draft"}
          </Button>
        </StickyActionBar>
      </form>
    );
  }

  const project = projects.find((p) => p.id === projectId);
  const totalActivities = draft.sections.reduce((sum, s) => sum + s.items.length, 0);

  function updateSectionTitle(sectionIdx: number, title: string) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.map((s, i) => (i === sectionIdx ? { ...s, title } : s));
      return { ...d, sections };
    });
  }

  function updateItem(
    sectionIdx: number,
    itemIdx: number,
    patch: Partial<ItpDraftResult["sections"][number]["items"][number]>
  ) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.map((s, si) => {
        if (si !== sectionIdx) return s;
        return { ...s, items: s.items.map((it, ii) => (ii === itemIdx ? { ...it, ...patch } : it)) };
      });
      return { ...d, sections };
    });
  }

  function removeItem(sectionIdx: number, itemIdx: number) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.map((s, si) => {
        if (si !== sectionIdx) return s;
        return { ...s, items: s.items.filter((_, ii) => ii !== itemIdx) };
      });
      return { ...d, sections };
    });
  }

  // Manual "+ Add activity" for a section — lets the user top up a section themselves (e.g. after
  // narrowing the AI's count-mode target) rather than only ever being able to Remove or regenerate
  // the whole draft. Starts blank; the same field-level editors below fill it in.
  function addItem(sectionIdx: number) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.map((s, si) => {
        if (si !== sectionIdx) return s;
        const nextNumber = `${sectionIdx + 1}.${s.items.length + 1}`;
        return {
          ...s,
          items: [
            ...s.items,
            {
              itemNumber: nextNumber,
              activity: "",
              referenceSpec: "",
              acceptanceCriteria: "",
              method: "",
              frequency: "",
              evidenceType: 1 as const,
              disciplineCode: null,
              suggestedInterventions: [],
            },
          ],
        };
      });
      return { ...d, sections };
    });
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-lg border border-border bg-surface-subtle p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>
              <Tx>Draft for</Tx> <span className="font-semibold text-ink">{project?.name ?? "the selected project"}</span>
            </span>
            <Badge tone="info"><Tx>AI-assisted draft</Tx></Badge>
          </p>
          <p className="text-xs text-muted">
            {draft.sections.length} <Tx>sections ·</Tx> {totalActivities} <Tx>activities total</Tx>
          </p>
        </div>
        <p className="mt-1 text-xs text-muted">
          <Tx>Edit anything below directly, use</Tx> <strong><Tx>+ Add activity</Tx></strong> <Tx>to top up a section, or describe a change and regenerate the whole draft instead of editing by hand.</Tx>
        </p>
        <form action={genFormAction} className="mt-3 space-y-2">
          <input type="hidden" name="project_id" value={projectId} />
          {selectedDocIds.map((id) => (
            <input key={id} type="hidden" name="vault_document_ids" value={id} />
          ))}
          <input type="hidden" name="additional_instructions" value={combinedInstructions(feedback ? `Feedback on the previous draft — apply this: ${feedback}` : undefined)} />
          {/* Keeps the already-suggested ITP number stable across regeneration instead of drawing a
              fresh one from the org's sequence on every "Regenerate with this feedback" click. */}
          <input type="hidden" name="existing_suggested_itp_number" value={itpNumber} />
          <textarea
            rows={2}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. &quot;too many Hold points on Voltway&quot;, &quot;missing a weld inspection step&quot;, &quot;split testing into two activities&quot;…"
            className="w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
          />
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={genPending || !feedback.trim()}
              variant="outline" size="sm"
            >
              {genPending ? "Regenerating…" : "Regenerate with this feedback"}
            </Button>
            {genState.error && <p role="alert" className="text-xs text-danger">{genState.error}</p>}
          </div>
        </form>
      </div>

      <form action={createFormAction} className="space-y-6">
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="draft_json" value={JSON.stringify(draft)} readOnly />
        <input type="hidden" name="ai_log_id" value={aiLogId ?? ""} />

        <div className="rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
          <p className="text-sm text-muted">
            <Tx>Auto-suggested from the org&apos;s numbering scheme and the source documents — review and edit before creating.</Tx>
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <FormField required label="ITP number">
                <input
                name="itp_number"
                required
                value={itpNumber}
                onChange={(e) => setItpNumber(e.target.value)}
                placeholder={tl("e.g. MER-JAGS-ITP-002")}
                className="mt-1.5 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm doc-id"
              />
              </FormField>
            </div>

            <div className="md:col-span-2">
              <FormField required label="Title">
                <input
                name="title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1.5 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
              />
              </FormField>
            </div>

            <div>
              <label htmlFor="ai_applicable_standard" className="block text-sm font-semibold text-ink">
                <Tx>Applicable standard</Tx> <span className="font-normal text-muted"><Tx>(optional)</Tx></span>
              </label>
              <input
                id="ai_applicable_standard"
                name="applicable_standard"
                value={applicableStandard}
                onChange={(e) => setApplicableStandard(e.target.value)}
                placeholder={tl("e.g. IEC 61439")}
                className="mt-1.5 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
              />
            </div>
          </div>
        </div>

        <div className="space-y-5">
          {draft.sections.map((section, sectionIdx) => (
            <div key={sectionIdx} className="rounded-lg border border-border">
              <div className="flex items-center justify-between gap-3 rounded-t-lg border-b border-border bg-surface-subtle px-3 py-2">
                <input
                  value={section.title}
                  onChange={(e) => updateSectionTitle(sectionIdx, e.target.value)}
                  aria-label={`Section ${sectionIdx + 1} title`}
                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-ink hover:border-border focus:border-burgundy focus:bg-surface focus:outline-none"
                />
                <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted">
                  {section.items.length} {section.items.length === 1 ? "activity" : "activities"}
                </span>
              </div>

              <div className="space-y-3 p-3">
                {section.items.length === 0 && (
                  <p className="rounded-md border border-dashed border-border bg-surface-subtle p-3 text-center text-xs text-muted">
                    <Tx>No activities in this section yet.</Tx>
                  </p>
                )}
                {section.items.map((item, itemIdx) => (
                  <div key={itemIdx} className="rounded-md border border-border bg-surface p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="doc-id rounded bg-surface-subtle px-2 py-1 text-xs font-medium text-ink">
                        <Tx>Item</Tx> {item.itemNumber || `${sectionIdx + 1}.${itemIdx + 1}`}
                      </span>
                      <Button
                        type="button"
                        onClick={() => removeItem(sectionIdx, itemIdx)}
                        variant="link-danger" size="sm"
                      >
                        <Tx>Remove</Tx>
                      </Button>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[80px_1fr]">
                      <div>
                        <FormField label="Item no.">
                          <input
                          value={item.itemNumber}
                          onChange={(e) => updateItem(sectionIdx, itemIdx, { itemNumber: e.target.value })}
                          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm doc-id"
                        />
                        </FormField>
                      </div>
                      <div>
                        <FormField label="Activity">
                          <input
                          value={item.activity}
                          onChange={(e) => updateItem(sectionIdx, itemIdx, { activity: e.target.value })}
                          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                        />
                        </FormField>
                      </div>
                    </div>

                    <div className="mt-3">
                      <FormField label="Acceptance criteria">
                        <textarea
                        value={item.acceptanceCriteria}
                        onChange={(e) => updateItem(sectionIdx, itemIdx, { acceptanceCriteria: e.target.value })}
                        rows={2}
                        className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                      />
                      </FormField>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="lg:col-span-2">
                        <FormField label="Reference (spec clause / standard)">
                          <input
                          value={item.referenceSpec}
                          onChange={(e) => updateItem(sectionIdx, itemIdx, { referenceSpec: e.target.value })}
                          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                        />
                        </FormField>
                      </div>
                      <div>
                        <FormField label="Discipline">
                          <select
                          value={item.disciplineCode ?? ""}
                          onChange={(e) => updateItem(sectionIdx, itemIdx, { disciplineCode: e.target.value || null })}
                          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                        >
                          <option value=""><Tx>No discipline</Tx></option>
                          {disciplines.map((d) => (
                            <option key={d.code} value={d.code}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                        </FormField>
                      </div>
                      <div>
                        <FormField label="Evidence type">
                          <select
                          value={item.evidenceType}
                          onChange={(e) => updateItem(sectionIdx, itemIdx, { evidenceType: Number(e.target.value) as 1 | 2 | 3 })}
                          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                        >
                          <option value={1}><Tx>Checklist</Tx></option>
                          <option value={2}><Tx>Document upload (certificate, test report, readings)</Tx></option>
                          {item.evidenceType === 3 && <option value={3}><Tx>Measurement (older ITP)</Tx></option>}
                        </select>
                        </FormField>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <FormField label="Method (e.g. Megger test)">
                          <input
                          value={item.method}
                          onChange={(e) => updateItem(sectionIdx, itemIdx, { method: e.target.value })}
                          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                        />
                        </FormField>
                      </div>
                      <div>
                        <FormField label="Frequency (e.g. Each circuit)">
                          <input
                          value={item.frequency}
                          onChange={(e) => updateItem(sectionIdx, itemIdx, { frequency: e.target.value })}
                          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                        />
                        </FormField>
                      </div>
                    </div>

                    {projectParties.length > 0 && interventionLevels.length > 0 && (
                      <div className="mt-3 rounded-md bg-surface-subtle p-2">
                        <p className="text-xs font-medium text-muted">
                          <Tx>Sign-off level per party — the AI&apos;s suggestion is pre-selected; change or clear any of them before creating the ITP</Tx>
                        </p>
                        <div className="mt-1.5 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                          {projectParties.map((party) => {
                            const current = item.suggestedInterventions.find((si) => si.projectPartyId === party.id);
                            return (
                              <label key={party.id} className="flex flex-col gap-1 text-sm text-ink sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                                <span className="min-w-0 truncate" title={current?.reason ? `AI: ${current.reason}` : party.name}>
                                  {party.name}
                                </span>
                                <select
                                  value={current?.intervention ?? ""}
                                  onChange={(e) => {
                                    const code = e.target.value;
                                    const others = item.suggestedInterventions.filter((si) => si.projectPartyId !== party.id);
                                    updateItem(sectionIdx, itemIdx, {
                                      suggestedInterventions: code
                                        ? [...others, { projectPartyId: party.id, intervention: code as never, reason: current?.reason ?? "Set by reviewer" }]
                                        : others,
                                    });
                                  }}
                                  className="min-h-10 rounded-md border border-border bg-surface px-2 py-1 text-sm sm:max-w-[60%]"
                                >
                                  <option value=""><Tx>— None —</Tx></option>
                                  {interventionLevels.map((l) => (
                                    <option key={l.code} value={l.code}>
                                      {l.label} ({l.code})
                                    </option>
                                  ))}
                                </select>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {item.disciplineCode && !disciplineNameByCode.has(item.disciplineCode) && (
                      <p className="mt-2 text-xs text-warning">
                        <Tx>Unrecognised discipline code &quot;</Tx>{item.disciplineCode}<Tx>&quot; — pick one from the list above.</Tx>
                      </p>
                    )}
                  </div>
                ))}

                <Button type="button" variant="outline" onClick={() => addItem(sectionIdx)} className="w-full border-dashed">
                  <Tx>+ Add activity to this section</Tx>
                </Button>
              </div>
            </div>
          ))}
        </div>

        <FormMessage error={createState.error} />

        <StickyActionBar>
          <Button type="submit" disabled={createPending}>
            {createPending ? "Creating…" : "Create ITP from this draft"}
          </Button>
          <Button
            type="button"
            onClick={() => {
              setDraft(null);
              // Without this, a discarded draft's suggested number/title/standard survive in state
              // (the `prev || ...` guards at lines 142-144 only fill an EMPTY field) and get silently
              // reused as the "suggestion" for the next generated draft, even once they're stale.
              setItpNumber("");
              setTitle("");
              setApplicableStandard("");
            }}
            variant="outline"
          >
            <Tx>Discard draft</Tx>
          </Button>
        </StickyActionBar>
      </form>
    </div>
  );
}
