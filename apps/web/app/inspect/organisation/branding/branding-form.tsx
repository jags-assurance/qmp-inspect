"use client";

import { useActionState, useState } from "react";
import { updateOrgBrandColorsAction, type BrandingSettingsState } from "@/lib/branding/actions";
import { Button } from "@/components/ui/button";

const initialState: BrandingSettingsState = { error: null };

const DEFAULT_PRIMARY = "#6b1e2c";
const DEFAULT_ACCENT = "#f5c518";

export function BrandingForm({
  organizationId,
  brandPrimaryColor,
  brandAccentColor,
}: {
  organizationId: string;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateOrgBrandColorsAction, initialState);
  const [primary, setPrimary] = useState(brandPrimaryColor ?? "");
  const [accent, setAccent] = useState(brandAccentColor ?? "");

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="organization_id" value={organizationId} />

      <div className="flex flex-wrap gap-6">
        <div>
          <label htmlFor="brand_primary_color" className="block text-xs text-muted">
            Primary color (burgundy)
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="color"
              aria-label="Primary color picker"
              value={primary || DEFAULT_PRIMARY}
              onChange={(e) => setPrimary(e.target.value)}
              className="h-9 w-9 cursor-pointer rounded border border-border bg-surface p-0.5"
            />
            <input
              id="brand_primary_color"
              name="brand_primary_color"
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              placeholder={DEFAULT_PRIMARY}
              className="w-32 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
            />
          </div>
        </div>

        <div>
          <label htmlFor="brand_accent_color" className="block text-xs text-muted">
            Accent color (gold)
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="color"
              aria-label="Accent color picker"
              value={accent || DEFAULT_ACCENT}
              onChange={(e) => setAccent(e.target.value)}
              className="h-9 w-9 cursor-pointer rounded border border-border bg-surface p-0.5"
            />
            <input
              id="brand_accent_color"
              name="brand_accent_color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              placeholder={DEFAULT_ACCENT}
              className="w-32 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
            />
          </div>
        </div>

        <div>
          <span className="block text-xs text-muted">Live preview</span>
          <div
            className="mt-1 flex items-center gap-2 rounded-md border border-border p-2"
            style={{
              // Direct inline style rather than the burgundy/gold utilities: this swatch previews
              // what's currently typed in the two fields above, which may not be saved yet.
              ["--preview-primary" as string]: primary || DEFAULT_PRIMARY,
              ["--preview-accent" as string]: accent || DEFAULT_ACCENT,
            }}
          >
            <span
              className="h-8 w-8 rounded-full border border-border"
              style={{ background: "var(--preview-primary)" }}
              title="Primary"
            />
            <span
              className="h-8 w-8 rounded-full border border-border"
              style={{ background: "var(--preview-accent)" }}
              title="Accent"
            />
            <span
              className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
              style={{ background: "var(--preview-primary)" }}
            >
              Sample button
            </span>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted">
        Leave either field blank to fall back to the default JAGS palette ({DEFAULT_PRIMARY} / {DEFAULT_ACCENT}).
        This overrides the in-app UI only — generated PDF reports keep the standard JAGS palette.
      </p>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save brand colors"}
      </Button>
    </form>
  );
}
