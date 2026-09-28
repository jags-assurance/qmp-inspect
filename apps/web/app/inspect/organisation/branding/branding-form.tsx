"use client";

import { useActionState, useState } from "react";
import { updateOrgBrandColorsAction, type BrandingSettingsState } from "@/lib/branding/actions";
import { Button } from "@/components/ui/button";

const initialState: BrandingSettingsState = { error: null };

const DEFAULT_PRIMARY = "#6b1e2c";
const DEFAULT_ACCENT = "#f5c518";
const DEFAULT_COLOR_3 = "#1f5f5b";
const DEFAULT_COLOR_4 = "#2f6fed";

function ColorField({
  id,
  name,
  label,
  value,
  defaultHex,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  defaultHex: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-muted">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={value || defaultHex}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-9 cursor-pointer rounded border border-border bg-surface p-0.5"
        />
        <input
          id={id}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={defaultHex}
          className="w-32 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>
    </div>
  );
}

export function BrandingForm({
  organizationId,
  brandPrimaryColor,
  brandAccentColor,
  brandColor3,
  brandColor4,
  brandMultiColorMode,
}: {
  organizationId: string;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
  brandColor3: string | null;
  brandColor4: string | null;
  brandMultiColorMode: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateOrgBrandColorsAction, initialState);
  const [primary, setPrimary] = useState(brandPrimaryColor ?? "");
  const [accent, setAccent] = useState(brandAccentColor ?? "");
  const [color3, setColor3] = useState(brandColor3 ?? "");
  const [color4, setColor4] = useState(brandColor4 ?? "");
  const [multiColor, setMultiColor] = useState(brandMultiColorMode);

  const p = primary || DEFAULT_PRIMARY;
  const a = accent || DEFAULT_ACCENT;
  const c3 = color3 || DEFAULT_COLOR_3;
  const c4 = color4 || DEFAULT_COLOR_4;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="organization_id" value={organizationId} />

      <div className="flex flex-wrap gap-6">
        <ColorField id="brand_primary_color" name="brand_primary_color" label="Primary color (burgundy)" value={primary} defaultHex={DEFAULT_PRIMARY} onChange={setPrimary} />
        <ColorField id="brand_accent_color" name="brand_accent_color" label="Accent color (gold)" value={accent} defaultHex={DEFAULT_ACCENT} onChange={setAccent} />

        <div>
          <span className="block text-xs text-muted">Live preview</span>
          <div className="mt-1 flex items-center gap-2 rounded-md border border-border p-2">
            <span className="h-8 w-8 rounded-full border border-border" style={{ background: p }} title="Primary" />
            <span className="h-8 w-8 rounded-full border border-border" style={{ background: a }} title="Accent" />
            <span className="rounded-md px-3 py-1.5 text-xs font-medium text-white" style={{ background: p }}>
              Sample button
            </span>
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="brand_multi_color_mode" checked={multiColor} onChange={(e) => setMultiColor(e.target.checked)} />
        Use a 4-color combo instead (Microsoft/Google-style multi-color mark)
      </label>

      {multiColor && (
        <div className="rounded-md border border-border bg-off-white p-4">
          <p className="text-xs text-muted">
            All four colors apply to this organisation&rsquo;s brand mark (e.g. the sidebar badge) for its own users — a
            solid 4-quadrant square like Microsoft&rsquo;s logo, or a 4-color conic ring like Gemini&rsquo;s, picked below.
          </p>
          <div className="mt-3 flex flex-wrap gap-6">
            <ColorField id="brand_color_3" name="brand_color_3" label="Third color" value={color3} defaultHex={DEFAULT_COLOR_3} onChange={setColor3} />
            <ColorField id="brand_color_4" name="brand_color_4" label="Fourth color" value={color4} defaultHex={DEFAULT_COLOR_4} onChange={setColor4} />

            <div>
              <span className="block text-xs text-muted">Combo preview</span>
              <div className="mt-1 flex items-center gap-4 rounded-md border border-border p-2">
                <div
                  aria-hidden
                  className="h-9 w-9 overflow-hidden rounded-md border border-border"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gridTemplateRows: "1fr 1fr",
                  }}
                  title="4-quadrant style (Microsoft-like)"
                >
                  <span style={{ background: p }} />
                  <span style={{ background: a }} />
                  <span style={{ background: c3 }} />
                  <span style={{ background: c4 }} />
                </div>
                <div
                  aria-hidden
                  className="h-9 w-9 rounded-full border border-border"
                  style={{ background: `conic-gradient(${p}, ${a}, ${c3}, ${c4}, ${p})` }}
                  title="Conic-ring style (Gemini-like)"
                />
                <span className="text-xs text-muted">Both styles use the same 4 colors — shown for reference; the badge itself uses the ring style.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-muted">
        Leave Primary/Accent blank to fall back to the default JAGS palette ({DEFAULT_PRIMARY} / {DEFAULT_ACCENT}).
        This overrides the in-app UI only — generated PDF reports keep the standard JAGS palette.
      </p>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save brand colors"}
      </Button>
    </form>
  );
}
