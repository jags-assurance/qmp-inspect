"use client";

import { useActionState, useState } from "react";
import { updateOrgBrandColorsAction, type BrandingSettingsState } from "@/lib/branding/actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";
import { FormMessage } from "@/components/ui/form-message";
import { MoreDetails } from "@/components/domain/more-details";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: BrandingSettingsState = { error: null };

const DEFAULT_PRIMARY = "#6b1e2c";
const DEFAULT_ACCENT = "#f5c518";
const NEW_EXTRA_DEFAULT = "#2f6fed";

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

let extraColorKeySeq = 0;

export function BrandingForm({
  organizationId,
  brandPrimaryColor,
  brandAccentColor,
  brandExtraColors,
  brandMultiColorMode,
}: {
  organizationId: string;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
  brandExtraColors: string[];
  brandMultiColorMode: boolean;
}) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(updateOrgBrandColorsAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);
  const [primary, setPrimary] = useState(brandPrimaryColor ?? "");
  const [accent, setAccent] = useState(brandAccentColor ?? "");
  const [multiColor, setMultiColor] = useState(brandMultiColorMode);
  // Any number of extra colors — client feedback: a fixed 4-color combo wasn't enough. Each row
  // gets a stable client-only key so React doesn't reuse a text input's DOM node (and its cursor
  // position) across an add/remove that shifts array indexes.
  const [extras, setExtras] = useState(() => brandExtraColors.map((color) => ({ key: extraColorKeySeq++, color })));

  const p = primary || DEFAULT_PRIMARY;
  const a = accent || DEFAULT_ACCENT;
  const comboColors = [p, a, ...extras.map((e) => e.color || NEW_EXTRA_DEFAULT)];

  return (
    <form onSubmit={keepValuesSubmit} className="space-y-4">
      <input type="hidden" name="organization_id" value={organizationId} />

      <div className="flex flex-wrap gap-6">
        <ColorField id="brand_primary_color" name="brand_primary_color" label="Primary color (burgundy)" value={primary} defaultHex={DEFAULT_PRIMARY} onChange={setPrimary} />
        <ColorField id="brand_accent_color" name="brand_accent_color" label="Accent color (gold)" value={accent} defaultHex={DEFAULT_ACCENT} onChange={setAccent} />

        <div>
          <span className="block text-xs text-muted"><Tx>Live preview</Tx></span>
          <div className="mt-1 flex items-center gap-2 rounded-md border border-border p-2">
            <span className="h-8 w-8 rounded-full border border-border" style={{ background: p }} title={tl("Primary")} />
            <span className="h-8 w-8 rounded-full border border-border" style={{ background: a }} title={tl("Accent")} />
            <span className="rounded-md px-3 py-1.5 text-xs font-medium text-white" style={{ background: p }}>
              <Tx>Sample button</Tx>
            </span>
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="brand_multi_color_mode" checked={multiColor} onChange={(e) => setMultiColor(e.target.checked)} />
        <Tx>Use a multi-color combo instead (Microsoft/Google-style multi-color mark)</Tx>
      </label>

      {multiColor && (
        <div className="rounded-md border border-border bg-off-white p-4">
          <MoreDetails className="mt-0">
            <p><Tx>Add as many extra colors as you want — there&rsquo;s no fixed count. All of them together (primary, accent, then these) become this organisation&rsquo;s brand mark (e.g. the sidebar badge) for its own users.</Tx></p>
          </MoreDetails>

          <div className="mt-3 flex flex-wrap gap-4">
            {extras.map((extra, index) => (
              <div key={extra.key} className="flex items-end gap-1">
                <ColorField
                  id={`brand_extra_color_${extra.key}`}
                  name="brand_extra_colors"
                  label={`Color ${index + 3}`}
                  value={extra.color}
                  defaultHex={NEW_EXTRA_DEFAULT}
                  onChange={(v) => setExtras((prev) => prev.map((e) => (e.key === extra.key ? { ...e, color: v } : e)))}
                />
                <button
                  type="button"
                  onClick={() => setExtras((prev) => prev.filter((e) => e.key !== extra.key))}
                  aria-label={`Remove color ${index + 3}`}
                  className="mb-1 h-9 rounded-md border border-border bg-surface px-2 text-sm text-muted hover:bg-surface-subtle hover:text-danger"
                >
                  ×
                </button>
              </div>
            ))}

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setExtras((prev) => [...prev, { key: extraColorKeySeq++, color: "" }])}
                className="h-9 rounded-md border border-dashed border-border bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-subtle"
              >
                <Tx>+ Add color</Tx>
              </button>
            </div>
          </div>

          {extras.length > 0 && (
            <div className="mt-4">
              <span className="block text-xs text-muted"><Tx>Combo preview (</Tx>{comboColors.length} <Tx>colors)</Tx></span>
              <div className="mt-1 flex items-center gap-4 rounded-md border border-border p-2">
                <div
                  aria-hidden
                  className="h-9 w-9 rounded-full border border-border"
                  style={{ background: `conic-gradient(${comboColors.join(", ")}, ${comboColors[0]})` }}
                  title={tl("How the sidebar badge will look")}
                />
                <span className="text-xs text-muted"><Tx>This is exactly how the sidebar badge renders for this organisation&rsquo;s own users.</Tx></span>
              </div>
            </div>
          )}
        </div>
      )}

      <MoreDetails className="mt-0">
        <p><Tx>Leave Primary/Accent blank to fall back to the default JAGS palette (</Tx>{DEFAULT_PRIMARY} / {DEFAULT_ACCENT}<Tx>). This overrides the in-app UI only — generated PDF reports keep the standard JAGS palette.</Tx></p>
      </MoreDetails>

      <FormMessage error={state.error} success={pending ? null : state.message} />

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save brand colors"}
      </Button>
    </form>
  );
}
