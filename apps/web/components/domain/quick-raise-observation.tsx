"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SidePanel, Toast, useToast } from "@/components/ui/side-panel";
import { enqueueOutboxItem } from "@/lib/offline/db";
import { notifyOutboxChanged } from "@/lib/offline/sync-client";
import { loadRaiseOptionsAction } from "@/lib/ncrs/raise-options-actions";
import { prepareOfflinePhoto } from "@/lib/offline/photo-prepare";
import { HeicConversionError } from "@/lib/media/heic";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const PROJECTS_CACHE_KEY = "jags.quickRaise.projects";

type ProjectOption = { id: string; label: string };

function readCachedProjects(): ProjectOption[] {
  try {
    const raw = localStorage.getItem(PROJECTS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as ProjectOption[]) : [];
  } catch {
    return [];
  }
}

function defaultDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Field-friendly "raise an observation in 3 fields" — project, what you saw, due date — that works
 * with no signal. It never calls the server directly: it writes to the same IndexedDB outbox
 * checklists use, and the offline banner replays it through the validated createNcrAction as soon as
 * a connection exists. The project list is cached from the last time the user was online. Deliberately
 * state-only (no ?panel= URL): navigating offline would need the server.
 */
export function QuickRaiseObservation() {
  const tl = useTranslate();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { message, show, dismiss } = useToast();

  async function openPanel() {
    setError(null);
    setProjects(readCachedProjects());
    setOpen(true);
    try {
      const options = await loadRaiseOptionsAction();
      const fresh = options.projects.map((p) => ({ id: p.id, label: `${p.project_number} — ${p.name}` }));
      setProjects(fresh);
      try {
        localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(fresh));
      } catch {
        // Cache is a convenience only.
      }
    } catch {
      // Offline (or server unreachable): keep whatever was cached.
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const projectId = String(form.get("project_id") ?? "");
    const description = String(form.get("description") ?? "").trim();
    const dueDate = String(form.get("due_date") ?? "");
    if (!projectId || !description || !dueDate) {
      setError("Project, what you saw and a due date are all required.");
      return;
    }
    // Same minimum the server enforces when the queued item is replayed — fail now, not hours later.
    if (description.length < 10) {
      setError("Describe what you saw in at least 10 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const rawPhoto = form.get("photo");
      const prepared = rawPhoto instanceof File && rawPhoto.size > 0 ? await prepareOfflinePhoto(rawPhoto) : null;
      if (prepared?.tooLarge) {
        setError("That photo is too large to save offline. Take it again at a lower resolution.");
        setSaving(false);
        return;
      }
      const photo = prepared?.file ?? null;
      await enqueueOutboxItem({
        kind: "raise_observation",
        fields: {
          kind: "raise_observation",
          project_id: projectId,
          description,
          due_date: dueDate,
          ...(photo ? { file_name: photo.name } : {}),
        },
        ...(photo ? { file: photo, fileName: photo.name } : {}),
      });
      notifyOutboxChanged();
      setOpen(false);
      show(navigator.onLine ? "Observation sent — it will show in the register in a moment." : "Saved on this device — it will be sent when you're back online.");
    } catch (err) {
      if (err instanceof HeicConversionError) {
        setError(err.message);
        return;
      }
      setError("Couldn't save on this device. Check browser storage isn't blocked and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={openPanel} className="min-h-11">
        <Tx>Report an issue</Tx>
      </Button>
      <SidePanel
        open={open}
        onClose={() => setOpen(false)}
        title={tl("Report an issue")}
        description="Three fields. Works offline — it's sent automatically once you have signal."
      >
        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="qr-project" className="block text-sm font-medium text-ink">
              <Tx>Project</Tx>
            </label>
            <select
              id="qr-project"
              name="project_id"
              required
              className="mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
            >
              <option value="">{projects.length === 0 ? "No projects saved yet — connect once to load them" : "Select…"}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="qr-description" className="block text-sm font-medium text-ink">
              <Tx>What did you see?</Tx>
            </label>
            <textarea
              id="qr-description"
              name="description"
              required
              rows={4}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
            />
          </div>
          <div>
            <label htmlFor="qr-due" className="block text-sm font-medium text-ink">
              <Tx>Due date</Tx>
            </label>
            <input
              id="qr-due"
              name="due_date"
              type="date"
              required
              defaultValue={defaultDueDate()}
              className="mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
            />
          </div>
          <div>
            <label htmlFor="qr-photo" className="block text-sm font-medium text-ink">
              <Tx>Photo (optional)</Tx>
            </label>
            <input
              id="qr-photo"
              name="photo"
              type="file"
              accept="image/*"
              capture="environment"
              className="mt-1 block min-h-11 w-full text-sm text-muted file:me-3 file:min-h-11 file:rounded-md file:border file:border-border file:bg-surface file:px-4 file:text-sm file:font-medium file:text-ink"
            />
          </div>
          <p className="text-xs text-muted">
            <Tx>This is recorded as an Issue, not an NCR. Add the assignee and responsible party afterwards from the NCR itself.</Tx>
          </p>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={saving} className="min-h-11 w-full">
            {saving ? "Saving…" : "Save observation"}
          </Button>
        </form>
      </SidePanel>
      <Toast message={message} onDismiss={dismiss} />
    </>
  );
}
