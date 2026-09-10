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

const INTERVENTION_LABEL: Record<"H" | "W" | "R" | "S", string> = {
  H: "Hold",
  W: "Witness",
  R: "Review",
  S: "Surveillance",
};

const createInitialState: CreateItpFromDraftState = { error: null };
const genInitialState: GenerateItpDraftState = { error: null, draft: null, projectParties: [] };

/** Metadata-only handle on a vault document — never its file content, see the picker below. */
export interface VaultDocumentOption {
  id: string;
  projectId: string;
  title: string;
  notes: string | null;
  documentNumber: string | null;
  documentReference: string | null;
  revision: string;
}

/**
 * Third "start an ITP" option: paste a spec/scope description, get an AI-generated draft back,
 * review and edit every field, then confirm. Nothing is written to the database until the final
 * "Create ITP from this draft" submit — the draft returned by generateItpDraftAction is held only
 * in this component's local state (mirrored into an editable copy) until then.
 */
export function NewItpFromAiForm({
  projects,
  vaultDocuments,
}: {
  projects: { id: string; project_number: string; name: string }[];
  /** All non-superseded vault documents this user can access, across projects — filtered to the
   *  selected project below. Metadata only (title/notes/document number/etc); the picker never
   *  reads or parses the underlying file. */
  vaultDocuments: VaultDocumentOption[];
}) {
  const [genState, genFormAction, genPending] = useActionState(generateItpDraftAction, genInitialState);
  const [draft, setDraft] = useState<ItpDraftResult | null>(null);
  const [projectParties, setProjectParties] = useState<GenerateItpDraftState["projectParties"]>([]);
  const [projectId, setProjectId] = useState("");
  const [specDescription, setSpecDescription] = useState("");
  const [attachedDocIds, setAttachedDocIds] = useState<string[]>([]);

  const projectVaultDocuments = vaultDocuments.filter((d) => d.projectId === projectId);
  const attachedDocs = vaultDocuments.filter((d) => attachedDocIds.includes(d.id));

  // Appends the picked document's own metadata (title/notes/document number/revision — not its
  // file content, which is never parsed here) as extra text context into the spec-description
  // textarea, per the task: "metadata-only, not full content parsing."
  function attachDocument(doc: VaultDocumentOption) {
    if (attachedDocIds.includes(doc.id)) return;
    setAttachedDocIds((ids) => [...ids, doc.id]);
    const parts = [
      `Reference document: ${doc.title}`,
      doc.documentNumber ? `Document number: ${doc.documentNumber}` : null,
      doc.documentReference ? `Document reference: ${doc.documentReference}` : null,
      `Revision: ${doc.revision}`,
      doc.notes ? `Notes: ${doc.notes}` : null,
    ].filter(Boolean);
    setSpecDescription((prev) => (prev ? `${prev}\n\n${parts.join(" — ")}` : parts.join(" — ")));
  }

  function removeAttachedDocument(docId: string) {
    setAttachedDocIds((ids) => ids.filter((id) => id !== docId));
  }

  // Derives the editable draft copy from a fresh generateItpDraftAction result during render
  // (React's documented "adjust state while rendering" pattern) rather than in a useEffect — this
  // avoids the extra commit-then-effect render pass for what is really just "seed local state from
  // a new action result".
  const [appliedGenState, setAppliedGenState] = useState(genState);
  if (genState !== appliedGenState) {
    setAppliedGenState(genState);
    if (genState.draft) {
      setDraft(genState.draft);
      setProjectParties(genState.projectParties);
    }
  }

  const [createState, createFormAction, createPending] = useActionState(
    createItpFromDraftAction,
    createInitialState
  );

  if (!draft) {
    return (
      <form action={genFormAction} className="mt-6 space-y-4">
        <div>
          <label htmlFor="ai_project_id" className="block text-sm font-medium text-ink">
            Project
          </label>
          <select
            id="ai_project_id"
            name="project_id"
            required
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          >
            <option value="">Select…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_number} — {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="spec_description" className="block text-sm font-medium text-ink">
            Spec / scope description
          </label>
          <textarea
            id="spec_description"
            name="spec_description"
            required
            rows={8}
            value={specDescription}
            onChange={(e) => setSpecDescription(e.target.value)}
            placeholder="Paste or describe the spec/scope for this ITP — e.g. materials, installation steps, testing and commissioning requirements…"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
          <p className="mt-1 text-xs text-muted">
            The AI drafts sections, activities and suggested intervention levels for you to review and
            edit below — nothing is created until you confirm.
          </p>

          {attachedDocs.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {attachedDocs.map((doc) => (
                <li
                  key={doc.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-burgundy/30 bg-burgundy/10 px-2.5 py-1 text-xs text-burgundy"
                >
                  📎 {doc.title}
                  <button
                    type="button"
                    onClick={() => removeAttachedDocument(doc.id)}
                    className="text-burgundy/70 hover:text-burgundy"
                    aria-label={`Remove attached document ${doc.title}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {projectId && (
            <div className="mt-3">
              <label htmlFor="vault_document_picker" className="block text-xs font-medium text-muted">
                Attach a vault document for context (metadata only — the file itself isn&apos;t
                parsed, so add anything specific from it directly into the description above)
              </label>
              <select
                id="vault_document_picker"
                value=""
                onChange={(e) => {
                  const doc = projectVaultDocuments.find((d) => d.id === e.target.value);
                  if (doc) attachDocument(doc);
                }}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
              >
                <option value="">
                  {projectVaultDocuments.length === 0 ? "No vault documents for this project" : "Select a document…"}
                </option>
                {projectVaultDocuments
                  .filter((d) => !attachedDocIds.includes(d.id))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.documentNumber ? `${d.documentNumber} — ` : ""}
                      {d.title}
                    </option>
                  ))}
              </select>
            </div>
          )}
        </div>

        {genState.error && <p className="text-sm text-danger">{genState.error}</p>}

        <Button type="submit" disabled={genPending}>
          {genPending ? "Generating…" : "Generate draft"}
        </Button>
      </form>
    );
  }

  const project = projects.find((p) => p.id === projectId);

  function updateSectionTitle(sectionIdx: number, title: string) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.map((s, i) => (i === sectionIdx ? { ...s, title } : s));
      return { sections };
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
      return { sections };
    });
  }

  function removeItem(sectionIdx: number, itemIdx: number) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.map((s, si) => {
        if (si !== sectionIdx) return s;
        return { ...s, items: s.items.filter((_, ii) => ii !== itemIdx) };
      });
      return { sections };
    });
  }

  return (
    <form action={createFormAction} className="mt-6 space-y-6">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="draft_json" value={JSON.stringify(draft)} readOnly />

      <div className="rounded-md border border-border bg-off-white p-3 text-sm text-muted">
        Draft for <span className="font-medium text-ink">{project?.name ?? "the selected project"}</span> —
        review and edit every field below before creating the ITP.
      </div>

      <div>
        <label htmlFor="ai_itp_number" className="block text-sm font-medium text-ink">
          ITP number
        </label>
        <input
          id="ai_itp_number"
          name="itp_number"
          required
          placeholder="e.g. MER-JAGS-ITP-002"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy doc-id"
        />
      </div>

      <div>
        <label htmlFor="ai_title" className="block text-sm font-medium text-ink">
          Title
        </label>
        <input
          id="ai_title"
          name="title"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div>
        <label htmlFor="ai_applicable_standard" className="block text-sm font-medium text-ink">
          Applicable standard
        </label>
        <input
          id="ai_applicable_standard"
          name="applicable_standard"
          placeholder="e.g. IEC 61439"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="space-y-4">
        {draft.sections.map((section, sectionIdx) => (
          <div key={sectionIdx} className="rounded-md border border-border p-3">
            <input
              value={section.title}
              onChange={(e) => updateSectionTitle(sectionIdx, e.target.value)}
              className="w-full rounded border border-border bg-surface px-2 py-1 text-sm font-medium text-ink"
            />
            <div className="mt-3 space-y-3">
              {section.items.map((item, itemIdx) => (
                <div key={itemIdx} className="rounded border border-border bg-off-white p-2 text-sm">
                  <div className="grid grid-cols-[100px_1fr] gap-2">
                    <input
                      value={item.itemNumber}
                      onChange={(e) => updateItem(sectionIdx, itemIdx, { itemNumber: e.target.value })}
                      className="rounded border border-border bg-surface px-2 py-1 doc-id"
                      placeholder="Item #"
                    />
                    <input
                      value={item.activity}
                      onChange={(e) => updateItem(sectionIdx, itemIdx, { activity: e.target.value })}
                      className="rounded border border-border bg-surface px-2 py-1"
                      placeholder="Activity"
                    />
                  </div>
                  <textarea
                    value={item.acceptanceCriteria}
                    onChange={(e) => updateItem(sectionIdx, itemIdx, { acceptanceCriteria: e.target.value })}
                    rows={2}
                    className="mt-2 w-full rounded border border-border bg-surface px-2 py-1"
                    placeholder="Acceptance criteria"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <select
                      value={item.evidenceType}
                      onChange={(e) =>
                        updateItem(sectionIdx, itemIdx, { evidenceType: Number(e.target.value) as 1 | 2 | 3 })
                      }
                      className="rounded border border-border bg-surface px-2 py-1 text-xs"
                    >
                      <option value={1}>Checklist</option>
                      <option value={2}>Document upload</option>
                      <option value={3}>Measurement record</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => removeItem(sectionIdx, itemIdx)}
                      className="text-xs text-danger hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                  {item.suggestedInterventions.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-muted">
                      {item.suggestedInterventions.map((si, siIdx) => {
                        const party = projectParties.find((p) => p.id === si.projectPartyId);
                        return (
                          <li key={siIdx}>
                            <span className="font-medium text-ink">{party?.name ?? "Unknown party"}</span>:{" "}
                            {INTERVENTION_LABEL[si.intervention]} — {si.reason}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {createState.error && <p className="text-sm text-danger">{createState.error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={createPending}>
          {createPending ? "Creating…" : "Create ITP from this draft"}
        </Button>
        <button
          type="button"
          onClick={() => setDraft(null)}
          className="rounded-md border border-border px-3 py-2 text-sm text-ink hover:bg-off-white"
        >
          Discard draft
        </button>
      </div>
    </form>
  );
}
