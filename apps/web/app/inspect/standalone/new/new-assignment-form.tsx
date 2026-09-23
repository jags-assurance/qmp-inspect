"use client";

import { useActionState, useState } from "react";
import { createAssignmentAction, type CreateAssignmentState, type AssignmentType } from "@/lib/standalone/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const initialState: CreateAssignmentState = { error: null };

// R10: the field set below is the same for every assignment type — that's the spec, not an
// oversight (a FAT and a witness inspection both need equipment/location/standard reference on
// file). What WAS a real usability problem, reported live: one long, undifferentiated list of
// fields read as "generic form for everything," with no visual cue that a FAT and a pre-shipment
// inspection are different kinds of work. Fixed by (a) splitting the form into three visually
// distinct groups instead of one long stack, and (b) a short, type-specific note under the type
// picker (below) that names what each type's own fields actually mean for THAT kind of work — no
// field is added, removed, or made conditional; this is purely about the form reading as organised
// rather than generic.
const ASSIGNMENT_TYPES: { value: AssignmentType; label: string; hint: string; equipmentNote: string }[] = [
  {
    value: "fat",
    label: "FAT",
    hint: "Factory Acceptance Test",
    equipmentNote: "The specific unit being tested at the manufacturer's works before it ships.",
  },
  {
    value: "witness_inspection",
    label: "Witness Inspection",
    hint: "Client/TPI witnesses a test",
    equipmentNote: "The item or system you're witnessing a test on — serial/tag if it has one.",
  },
  {
    value: "specific_test",
    label: "Specific Test",
    hint: "A single named test or check",
    equipmentNote: "What's being tested and where — a single named check, not a full ITP.",
  },
  {
    value: "pre_shipment",
    label: "Pre-Shipment",
    hint: "Final check before dispatch",
    equipmentNote: "The item as it will actually ship — condition, completeness, and packing.",
  },
];

export function NewAssignmentForm({
  projects,
  disciplines,
}: {
  projects: { id: string; project_number: string; name: string }[];
  disciplines: { id: string; code: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(createAssignmentAction, initialState);
  const [selectedType, setSelectedType] = useState<AssignmentType>(ASSIGNMENT_TYPES[0].value);
  const selected = ASSIGNMENT_TYPES.find((t) => t.value === selectedType) ?? ASSIGNMENT_TYPES[0];

  return (
    <form action={formAction} className="mt-6 space-y-6">
      <fieldset className="space-y-4 rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted">Project &amp; type</legend>
        <div>
          <label htmlFor="project_id" className="block text-sm font-medium text-ink">
            Project
          </label>
          <select
            id="project_id"
            name="project_id"
            required
            className="mt-1 w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
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
                  "flex cursor-pointer flex-col gap-0.5 rounded-md border border-border bg-off-white px-3 py-2",
                  "has-[:checked]:border-burgundy has-[:checked]:bg-burgundy/5"
                )}
              >
                <input
                  type="radio"
                  name="assignment_type"
                  value={type.value}
                  defaultChecked={i === 0}
                  required
                  onChange={() => setSelectedType(type.value)}
                  className="sr-only"
                />
                <span className="text-sm font-medium text-ink">{type.label}</span>
                <span className="text-xs text-muted">{type.hint}</span>
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted">Equipment</legend>
        <p className="text-xs text-muted">{selected.equipmentNote}</p>

        <div>
          <label htmlFor="equipment_description" className="block text-sm font-medium text-ink">
            Equipment description
          </label>
          <input
            id="equipment_description"
            name="equipment_description"
            required
            placeholder="e.g. Jaw crusher C120"
            className="mt-1 w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
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
              className="mt-1 w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
            />
          </div>
          <div>
            <label htmlFor="model" className="block text-sm font-medium text-ink">
              Model
            </label>
            <input
              id="model"
              name="model"
              className="mt-1 w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
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
              className="mt-1 w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
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
              className="mt-1 w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border border-border bg-surface p-4">
        <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted">Reference</legend>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="standard_reference" className="block text-sm font-medium text-ink">
              Standard reference
            </label>
            <input
              id="standard_reference"
              name="standard_reference"
              placeholder="e.g. ISO 9001 / client spec no."
              className="mt-1 w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
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
              className="mt-1 w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
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
            className="mt-1 w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
          >
            <option value="">—</option>
            {disciplines.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create assignment"}
      </Button>
    </form>
  );
}
