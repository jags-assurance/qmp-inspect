"use client";

import { useActionState, useState } from "react";
import { createAssignmentAction, type CreateAssignmentState, type AssignmentType } from "@/lib/standalone/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { cn } from "@/lib/cn";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

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
  presetsByProject,
}: {
  projects: { id: string; project_number: string; name: string }[];
  disciplines: { id: string; code: string; name: string }[];
  presetsByProject: Record<string, string[]>;
}) {
  const tl = useTranslate();
  // Date bounds are captured once at mount (impure Date.now() must not run on every render).
  const [dateBounds] = useState(() => ({
    min: new Date(Date.now() - 5 * 365 * 86400000).toISOString().slice(0, 10),
    max: new Date(Date.now() + 2 * 365 * 86400000).toISOString().slice(0, 10),
  }));
  const [projectId, setProjectId] = useState("");
  const [location, setLocation] = useState("");
  const [locError, setLocError] = useState<string | null>(null);
  const presets = presetsByProject[projectId] ?? [];

  function captureLive() {
    setLocError(null);
    if (!navigator.geolocation) {
      setLocError("Live location isn't available on this device.");
      setLocation("");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`),
      () => {
        setLocError("Couldn't get your live location. Allow location access or choose a project location.");
        setLocation("");
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  const [state, formAction, pending] = useActionState(createAssignmentAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);
  const [selectedType, setSelectedType] = useState<AssignmentType>(ASSIGNMENT_TYPES[0].value);
  const selected = ASSIGNMENT_TYPES.find((t) => t.value === selectedType) ?? ASSIGNMENT_TYPES[0];

  return (
    <form onSubmit={keepValuesSubmit} className="mt-6 space-y-6">
      <p className="text-xs text-muted"><span aria-hidden="true" className="text-danger">*</span> <Tx>required</Tx></p>
      <fieldset className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
        <legend className="px-1 text-sm font-semibold text-ink"><Tx>Project &amp; type</Tx></legend>
        <div>
          <FormField required label="Project">
            <select
            name="project_id"
            required
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setLocation((l) => (/^-?\d/.test(l) ? l : ""));
            }}
            className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
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

        <div>
          <span className="block text-sm font-medium text-ink"><Tx>Assignment type</Tx></span>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ASSIGNMENT_TYPES.map((type, i) => (
              <label
                key={type.value}
                className={cn(
                  "flex min-h-11 cursor-pointer flex-col gap-0.5 rounded-md border border-control-border bg-surface px-3 py-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus",
                  "has-[:checked]:border-burgundy has-[:checked]:bg-brand-soft"
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

      <fieldset className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
        <legend className="px-1 text-sm font-semibold text-ink"><Tx>Equipment</Tx></legend>
        <p className="text-xs text-muted">{selected.equipmentNote}</p>

        <div>
          <FormField required label="Equipment description">
            <input
            name="equipment_description"
            required
            maxLength={300}
            placeholder={tl("e.g. Jaw crusher C120")}
            className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
          />
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FormField label="Manufacturer">
              <input
              name="manufacturer"
              placeholder={tl("e.g. Metso")}
              className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
            />
            </FormField>
          </div>
          <div>
            <FormField label="Model">
              <input
              name="model"
              placeholder="e.g. C120"
              className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
            />
            </FormField>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FormField required={selectedType === "fat" || selectedType === "pre_shipment"} label={<Tx>Serial / tag no.</Tx>}>
              <input
              name="serial_tag"
              maxLength={120}
              required={selectedType === "fat" || selectedType === "pre_shipment"}
              placeholder={tl("e.g. SN-48213 / TAG-102")}
              className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
            />
            </FormField>
          </div>
          <div>
            <label htmlFor="location" className="block text-sm font-medium text-ink">
              <Tx>Location</Tx>
            </label>
            <input type="hidden" name="location" value={location} />
            <select
              id="location"
              value={presets.includes(location) ? location : location ? "live" : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "live") captureLive();
                else setLocation(v);
              }}
              className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
            >
              <option value=""><Tx>No location</Tx></option>
              <option value="live"><Tx>Use live location</Tx></option>
              {presets.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            {locError && <p role="alert" className="mt-1 text-xs text-danger">{locError}</p>}
            {/^-?\d/.test(location) && <p className="mt-1 text-xs text-muted"><Tx>Live:</Tx> {location}</p>}
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
        <legend className="px-1 text-sm font-semibold text-ink"><Tx>Reference</Tx></legend>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <FormField label="Standard reference">
              <input
              name="standard_reference"
              placeholder={tl("e.g. ISO 9001 / client spec no.")}
              className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
            />
            </FormField>
          </div>
          <div>
            <FormField label="Assignment date">
              <input
              name="assignment_date"
              type="date"
              min={dateBounds.min}
              max={dateBounds.max}
              className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
            />
            </FormField>
          </div>
        </div>

        <div>
          <FormField label="Discipline">
            <select
            name="discipline_id"
            defaultValue=""
            className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
          >
            <option value="">—</option>
            {disciplines.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>
          </FormField>
        </div>
      </fieldset>

      <FormMessage error={state.error} />

      <StickyActionBar>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create assignment"}
        </Button>
      </StickyActionBar>
    </form>
  );
}
