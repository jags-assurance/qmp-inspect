"use client";

import { useActionState } from "react";
import { createAssignmentAction, type CreateAssignmentState, type AssignmentType } from "@/lib/standalone/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const initialState: CreateAssignmentState = { error: null };

const ASSIGNMENT_TYPES: { value: AssignmentType; label: string; hint: string }[] = [
  { value: "fat", label: "FAT", hint: "Factory Acceptance Test" },
  { value: "witness_inspection", label: "Witness Inspection", hint: "Client/TPI witnesses a test" },
  { value: "specific_test", label: "Specific Test", hint: "A single named test or check" },
  { value: "pre_shipment", label: "Pre-Shipment", hint: "Final check before dispatch" },
];

export function NewAssignmentForm({
  projects,
  disciplines,
}: {
  projects: { id: string; project_number: string; name: string }[];
  disciplines: { id: string; code: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(createAssignmentAction, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label htmlFor="project_id" className="block text-sm font-medium text-ink">
          Project
        </label>
        <select
          id="project_id"
          name="project_id"
          required
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
        <span className="block text-sm font-medium text-ink">Assignment type</span>
        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ASSIGNMENT_TYPES.map((type, i) => (
            <label
              key={type.value}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-md border border-border bg-surface px-3 py-2",
                "has-[:checked]:border-burgundy has-[:checked]:bg-burgundy/5"
              )}
            >
              <input
                type="radio"
                name="assignment_type"
                value={type.value}
                defaultChecked={i === 0}
                required
                className="sr-only"
              />
              <span className="text-sm font-medium text-ink">{type.label}</span>
              <span className="text-xs text-muted">{type.hint}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="equipment_description" className="block text-sm font-medium text-ink">
          Equipment description
        </label>
        <input
          id="equipment_description"
          name="equipment_description"
          required
          placeholder="e.g. Jaw crusher C120"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="manufacturer" className="block text-sm font-medium text-ink">
            Manufacturer
          </label>
          <input
            id="manufacturer"
            name="manufacturer"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
        </div>
        <div>
          <label htmlFor="model" className="block text-sm font-medium text-ink">
            Model
          </label>
          <input
            id="model"
            name="model"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="serial_tag" className="block text-sm font-medium text-ink">
            Serial / tag no.
          </label>
          <input
            id="serial_tag"
            name="serial_tag"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
        </div>
        <div>
          <label htmlFor="location" className="block text-sm font-medium text-ink">
            Location
          </label>
          <input
            id="location"
            name="location"
            placeholder="e.g. Client works, Bay 3"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="standard_reference" className="block text-sm font-medium text-ink">
            Standard reference
          </label>
          <input
            id="standard_reference"
            name="standard_reference"
            placeholder="e.g. ISO 9001 / client spec no."
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
        </div>
        <div>
          <label htmlFor="assignment_date" className="block text-sm font-medium text-ink">
            Assignment date
          </label>
          <input
            id="assignment_date"
            name="assignment_date"
            type="date"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
        </div>
      </div>

      <div>
        <label htmlFor="discipline_id" className="block text-sm font-medium text-ink">
          Discipline
        </label>
        <select
          id="discipline_id"
          name="discipline_id"
          defaultValue=""
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        >
          <option value="">—</option>
          {disciplines.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} — {d.name}
            </option>
          ))}
        </select>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create assignment"}
      </Button>
    </form>
  );
}
