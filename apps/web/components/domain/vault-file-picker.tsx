"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { uploadVaultDocumentAction } from "@/lib/vault/actions";

export interface VaultPickerDocument {
  id: string;
  title: string;
  documentReference: string | null;
  folderName: string;
  revision?: string | null;
  /** vault_documents.status — approved | for_review | rejected | superseded. Missing = treated as approved. */
  status?: string | null;
  /** ISO timestamp the file was uploaded. */
  createdAt?: string | null;
  /** Extension such as "pdf"; derived from the title / storagePath when missing. */
  fileType?: string | null;
  storagePath?: string | null;
}

export interface VaultPickerFolder {
  id: string;
  key: string;
  name: string;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const BLOCKED = /\.(exe|bat|cmd|com|msi|scr|ps1|sh|js|mjs|vbs|jar|dll|apk|app|bin|reg|lnk|html?|php|py)$/i;
const ALLOWED = /\.(pdf|docx?|xlsx?|csv|txt|png|jpe?g|gif|webp|heic|bmp|tiff?)$/i;
const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,image/*";

const STATUS_META: Record<string, { label: string; className: string; why: string }> = {
  approved: { label: "Approved", className: "bg-success/10 text-success", why: "" },
  for_review: {
    label: "For review",
    className: "bg-warning/15 text-warning",
    why: "Not selectable yet: this file is still waiting for approval in the Document Vault.",
  },
  rejected: {
    label: "Rejected",
    className: "bg-danger/10 text-danger",
    why: "Not selectable: this file was rejected in the Document Vault.",
  },
  superseded: {
    label: "Superseded",
    className: "bg-danger/10 text-danger",
    why: "Not selectable: a newer revision replaced this file.",
  },
};

function statusOf(d: VaultPickerDocument) {
  return d.status ?? "approved";
}

function extOf(d: VaultPickerDocument): string {
  if (d.fileType) return d.fileType.replace(/^\./, "").toLowerCase();
  for (const s of [d.storagePath, d.title]) {
    const m = s?.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (m) return m[1].toLowerCase();
  }
  return "file";
}

function typeBadge(ext: string): { label: string; className: string } {
  if (ext === "pdf") return { label: "PDF", className: "bg-danger/10 text-danger" };
  if (ext === "doc" || ext === "docx") return { label: "DOC", className: "bg-blue-100 text-blue-700" };
  if (ext === "xls" || ext === "xlsx" || ext === "csv") return { label: ext === "csv" ? "CSV" : "XLS", className: "bg-success/10 text-success" };
  if (/^(png|jpe?g|gif|webp|heic|bmp|tiff?)$/.test(ext)) return { label: "IMG", className: "bg-purple-100 text-purple-700" };
  if (ext === "txt" || ext === "md") return { label: "TXT", className: "bg-off-white text-muted" };
  return { label: ext.slice(0, 4).toUpperCase(), className: "bg-off-white text-muted" };
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function titleFromFilename(filename: string): string {
  const withoutExt = filename.replace(/\.[^/.]+$/, "");
  return withoutExt.replace(/[_-]+/g, " ").trim() || filename;
}

function TypeBadge({ doc }: { doc: VaultPickerDocument }) {
  const b = typeBadge(extOf(doc));
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-8 w-9 shrink-0 items-center justify-center rounded text-xs font-bold ${b.className}`}
    >
      {b.label}
    </span>
  );
}

/**
 * Document browser for the project's Document Vault: folders are collapsible sections (collapsed unless
 * searching or holding a selection), each file shows type, reference, revision, status and date. Only
 * approved files are selectable (plus, with `allowPendingUploads`, files uploaded right here). A sticky
 * tray lists the chosen files, and files can be uploaded inline into a chosen vault folder. The choice is
 * submitted as repeated `name` fields so the surrounding server action receives every selected file.
 */
export function VaultFilePicker({
  documents,
  name = "vault_document_id",
  disabled = false,
  projectId,
  folders,
  allowUpload = false,
  allowPendingUploads = false,
  onSelectionChange,
}: {
  documents: VaultPickerDocument[];
  name?: string;
  disabled?: boolean;
  projectId?: string;
  folders?: VaultPickerFolder[];
  allowUpload?: boolean;
  allowPendingUploads?: boolean;
  onSelectionChange?: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const [uploaded, setUploaded] = useState<VaultPickerDocument[]>([]);
  const uploadedIds = useMemo(() => new Set(uploaded.map((d) => d.id)), [uploaded]);

  const canUpload = allowUpload && !!projectId && !!folders && folders.length > 0;

  const allDocs = useMemo(() => {
    const seen = new Set(documents.map((d) => d.id));
    return [...documents, ...uploaded.filter((d) => !seen.has(d.id))];
  }, [documents, uploaded]);
  const byId = useMemo(() => new Map(allDocs.map((d) => [d.id, d])), [allDocs]);

  function selectable(d: VaultPickerDocument): boolean {
    if (statusOf(d) === "approved") return true;
    return allowPendingUploads && uploadedIds.has(d.id) && statusOf(d) === "for_review";
  }

  function whyNot(d: VaultPickerDocument): string {
    if (statusOf(d) === "for_review" && uploadedIds.has(d.id)) {
      return "Uploaded now and pending approval — it can't be linked here until it is approved in the Document Vault.";
    }
    return STATUS_META[statusOf(d)]?.why ?? "This file can't be selected.";
  }

  const statuses = useMemo(() => [...new Set(allDocs.map(statusOf))], [allDocs]);
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const matches = allDocs.filter(
      (d) =>
        (statusFilter === "all" || statusOf(d) === statusFilter) &&
        (!q || `${d.title} ${d.documentReference ?? ""} ${d.folderName}`.toLowerCase().includes(q))
    );
    const byFolder = new Map<string, VaultPickerDocument[]>();
    for (const d of matches) {
      const list = byFolder.get(d.folderName) ?? [];
      list.push(d);
      byFolder.set(d.folderName, list);
    }
    return [...byFolder.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [allDocs, q, statusFilter]);

  useEffect(() => {
    onSelectionChange?.([...selected]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleFolder(docs: VaultPickerDocument[]) {
    const pickable = docs.filter(selectable);
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = pickable.every((d) => next.has(d.id));
      for (const d of pickable) {
        if (allOn) next.delete(d.id);
        else next.add(d.id);
      }
      return next;
    });
  }

  function onUploaded(docs: VaultPickerDocument[]) {
    setUploaded((prev) => [...prev, ...docs]);
    if (allowPendingUploads) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const d of docs) next.add(d.id);
        return next;
      });
    }
    setOverride((prev) => {
      const next = { ...prev };
      for (const d of docs) next[d.folderName] = true;
      return next;
    });
  }

  const selectedDocs = [...selected].map((id) => byId.get(id)).filter((d): d is VaultPickerDocument => !!d);

  return (
    <div className="space-y-2">
      {[...selected].map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title, reference or folder…"
          aria-label="Search vault files"
          disabled={disabled}
          className="min-h-11 w-full flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        {statuses.length > 1 && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            disabled={disabled}
            className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-burgundy"
          >
            <option value="all">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s]?.label ?? s}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto rounded-md border border-border bg-surface">
        {groups.length === 0 && <p className="px-3 py-3 text-sm text-muted">No files match.</p>}
        {groups.map(([folderName, docs]) => {
          const pickable = docs.filter(selectable);
          const allOn = pickable.length > 0 && pickable.every((d) => selected.has(d.id));
          const selCount = docs.filter((d) => selected.has(d.id)).length;
          const expanded = override[folderName] ?? (q !== "" || selCount > 0);
          const panelId = `vault-folder-${folderName.replace(/[^a-zA-Z0-9]/g, "_")}`;
          return (
            <section key={folderName} aria-label={folderName} className="border-b border-border last:border-0">
              <div className="flex items-center justify-between gap-2 bg-off-white pr-2">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => setOverride((p) => ({ ...p, [folderName]: !expanded }))}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 text-left"
                >
                  <span aria-hidden="true" className={`text-xs text-muted transition-transform ${expanded ? "rotate-90" : ""}`}>
                    ▶
                  </span>
                  <span className="min-w-0 truncate text-sm font-semibold text-ink">{folderName}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {docs.length} file{docs.length === 1 ? "" : "s"}
                    {selCount > 0 ? ` · ${selCount} selected` : ""}
                  </span>
                </button>
                {expanded && pickable.length > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleFolder(docs)}
                    disabled={disabled}
                    className="min-h-11 shrink-0 px-2 text-xs font-medium text-burgundy hover:underline"
                  >
                    {allOn ? "Clear folder" : "Select all in folder"}
                  </button>
                )}
              </div>
              {expanded && (
                <ul id={panelId}>
                  {docs.map((d) => {
                    const ok = selectable(d);
                    const meta = STATUS_META[statusOf(d)] ?? { label: statusOf(d), className: "bg-off-white text-muted", why: "" };
                    const date = formatDate(d.createdAt);
                    const isNew = uploadedIds.has(d.id);
                    return (
                      <li key={d.id} title={ok ? undefined : whyNot(d)}>
                        <label
                          className={`flex min-h-11 items-start gap-2.5 border-t border-border px-3 py-2 text-sm ${
                            ok && !disabled ? "cursor-pointer hover:bg-off-white" : "cursor-not-allowed opacity-60"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(d.id)}
                            onChange={() => toggle(d.id)}
                            disabled={disabled || !ok}
                            aria-label={`Select ${d.title}${ok ? "" : ` (${meta.label} — not selectable)`}`}
                            className="mt-1.5 h-5 w-5 shrink-0"
                          />
                          <TypeBadge doc={d} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-ink [overflow-wrap:anywhere]">{d.title}</span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                              {d.documentReference && <span>{d.documentReference}</span>}
                              {d.revision && <span>Rev {d.revision}</span>}
                              {date && <span>{date}</span>}
                              <span className={`rounded-full px-2 py-0.5 font-medium ${meta.className}`}>
                                {isNew && statusOf(d) === "for_review" ? "For review — pending approval" : meta.label}
                              </span>
                            </span>
                            {!ok && <span className="mt-0.5 block text-xs text-muted">{whyNot(d)}</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {canUpload && (
        <InlineUpload
          projectId={projectId!}
          folders={folders!}
          disabled={disabled}
          onUploaded={onUploaded}
          pendingNote={
            allowPendingUploads
              ? "Uploaded files are added to the list as “For review” and selected for you; they stay pending until approved in the Document Vault."
              : "Uploaded files appear in the list as “For review” and can be linked once they are approved in the Document Vault."
          }
        />
      )}

      <div className="sticky bottom-0 z-10 rounded-md border border-border bg-surface p-2 shadow-sm" aria-live="polite">
        <p className="text-xs font-medium text-ink">
          {selected.size === 0 ? "No files selected yet." : `${selected.size} file${selected.size === 1 ? "" : "s"} selected.`}
        </p>
        {selectedDocs.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Selected files">
            {selectedDocs.map((d) => (
              <li
                key={d.id}
                className="flex max-w-full items-center gap-1 rounded-full border border-border bg-off-white py-0.5 pl-2.5 pr-0.5 text-xs text-ink"
              >
                <span className="truncate">{d.title}</span>
                <button
                  type="button"
                  onClick={() => toggle(d.id)}
                  disabled={disabled}
                  aria-label={`Remove ${d.title} from selection`}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:text-danger sm:h-8 sm:w-8"
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function InlineUpload({
  projectId,
  folders,
  disabled,
  onUploaded,
  pendingNote,
}: {
  projectId: string;
  folders: VaultPickerFolder[];
  disabled: boolean;
  onUploaded: (docs: VaultPickerDocument[]) => void;
  pendingNote: string;
}) {
  const [open, setOpen] = useState(false);
  const defaultFolder = folders.find((f) => f.key === "checklists_forms") ?? folders[0];
  const [folderId, setFolderId] = useState(defaultFolder.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload() {
    const files = Array.from(inputRef.current?.files ?? []);
    if (files.length === 0) return setError("Choose one or more files first.");
    const folder = folders.find((f) => f.id === folderId) ?? defaultFolder;
    setBusy(true);
    setError(null);
    setInfo(null);
    const supabase = createSupabaseBrowserClient();
    const added: VaultPickerDocument[] = [];
    const errors: string[] = [];
    for (const file of files) {
      if (BLOCKED.test(file.name) || !ALLOWED.test(file.name)) {
        errors.push(`${file.name}: type not allowed (use PDF, Word, Excel, CSV, TXT or an image).`);
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        errors.push(`${file.name}: larger than 25 MB.`);
        continue;
      }
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `vault/${projectId}/${folder.key}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from("inspection-evidence").upload(path, file);
      if (upErr) {
        errors.push(`${file.name}: upload failed — check your connection and try again.`);
        continue;
      }
      const title = titleFromFilename(file.name);
      const fd = new FormData();
      fd.set("folder_id", folder.id);
      fd.set("project_id", projectId);
      fd.set("storage_path", path);
      fd.set("file_size", String(file.size));
      fd.set("title", title);
      fd.set("document_reference", "");
      fd.set("revision", "");
      fd.set("document_date", "");
      fd.set("notes", "");
      const r = await uploadVaultDocumentAction({ error: null }, fd);
      if (r.error || !r.documentId) {
        await supabase.storage.from("inspection-evidence").remove([path]);
        errors.push(`${file.name}: ${r.error ?? "could not be saved."}`);
        continue;
      }
      added.push({
        id: r.documentId,
        title,
        documentReference: null,
        folderName: folder.name,
        revision: "0",
        status: "for_review",
        createdAt: new Date().toISOString(),
        storagePath: path,
        fileType: file.name.split(".").pop()?.toLowerCase() ?? null,
      });
    }
    if (added.length > 0) {
      onUploaded(added);
      setInfo(`${added.length} file${added.length === 1 ? "" : "s"} uploaded.`);
      if (inputRef.current) inputRef.current.value = "";
    }
    if (errors.length > 0) setError(errors.join("\n"));
    setBusy(false);
  }

  return (
    <div className="rounded-md border border-dashed border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm font-medium text-burgundy"
      >
        <span aria-hidden="true">{open ? "−" : "+"}</span> Upload new file(s)
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-3">
          <div>
            <label htmlFor="vault-upload-folder" className="block text-xs text-muted">
              Save into folder
            </label>
            <select
              id="vault-upload-folder"
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              disabled={busy}
              className="mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm"
            >
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="vault-upload-files" className="block text-xs text-muted">
              Files (PDF, Word, Excel, CSV, TXT or images, max 25 MB each)
            </label>
            <input
              ref={inputRef}
              id="vault-upload-files"
              type="file"
              multiple
              accept={ACCEPT}
              disabled={busy}
              className="mt-1 block w-full text-sm file:mr-3 file:min-h-11 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:text-sm"
            />
          </div>
          <p className="text-xs text-muted">{pendingNote}</p>
          {info && (
            <p role="status" className="text-xs text-success">
              {info}
            </p>
          )}
          {error && (
            <p role="alert" className="whitespace-pre-line text-xs text-danger">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={upload}
            disabled={busy || disabled}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-border bg-burgundy px-3 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      )}
    </div>
  );
}
