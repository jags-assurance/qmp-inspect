"use client";

import { useMemo, useState } from "react";

export interface VaultPickerDocument {
  id: string;
  title: string;
  documentReference: string | null;
  folderName: string;
  revision?: string | null;
}

/**
 * Pick one or more FILES from the project's Document Vault. Files are listed under their folder with a
 * checkbox each (a folder is only a heading — it is never itself linked), with search and a
 * "select all in this folder" shortcut. The choice is submitted as repeated `name` fields, so the
 * server action receives every selected file in one go: choose first, then link.
 */
export function VaultFilePicker({
  documents,
  name = "vault_document_id",
  disabled = false,
}: {
  documents: VaultPickerDocument[];
  name?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const folders = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = documents.filter(
      (d) => !q || `${d.title} ${d.documentReference ?? ""} ${d.folderName}`.toLowerCase().includes(q)
    );
    const byFolder = new Map<string, VaultPickerDocument[]>();
    for (const d of matches) {
      const list = byFolder.get(d.folderName) ?? [];
      list.push(d);
      byFolder.set(d.folderName, list);
    }
    return [...byFolder.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [documents, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleFolder(docs: VaultPickerDocument[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = docs.every((d) => next.has(d.id));
      for (const d of docs) {
        if (allOn) next.delete(d.id);
        else next.add(d.id);
      }
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {[...selected].map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search files by name, reference or folder…"
        aria-label="Search vault files"
        disabled={disabled}
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-burgundy"
      />
      <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-surface">
        {folders.length === 0 && <p className="px-3 py-3 text-sm text-muted">No files match.</p>}
        {folders.map(([folderName, docs]) => {
          const allOn = docs.every((d) => selected.has(d.id));
          return (
            <section key={folderName} aria-label={folderName} className="border-b border-border last:border-0">
              <div className="flex items-center justify-between gap-2 bg-off-white px-3 py-1.5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {folderName} <span className="font-normal normal-case">({docs.length})</span>
                </h4>
                <button type="button" onClick={() => toggleFolder(docs)} disabled={disabled} className="text-xs text-burgundy hover:underline">
                  {allOn ? "Clear folder" : "Select all files"}
                </button>
              </div>
              <ul>
                {docs.map((d) => (
                  <li key={d.id}>
                    <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 text-sm hover:bg-off-white">
                      <input
                        type="checkbox"
                        checked={selected.has(d.id)}
                        onChange={() => toggle(d.id)}
                        disabled={disabled}
                        className="mt-0.5 h-4 w-4 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block text-ink [overflow-wrap:anywhere]">{d.title}</span>
                        {(d.documentReference || d.revision) && (
                          <span className="block text-xs text-muted">
                            {d.documentReference}
                            {d.documentReference && d.revision ? " · " : ""}
                            {d.revision ? `Rev ${d.revision}` : ""}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="text-xs text-muted" aria-live="polite">
        {selected.size === 0 ? "No files selected yet." : `${selected.size} file${selected.size === 1 ? "" : "s"} selected.`}
      </p>
    </div>
  );
}
