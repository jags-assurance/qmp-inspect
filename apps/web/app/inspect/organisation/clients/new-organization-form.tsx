"use client";

import { useActionState } from "react";
import { createOrganizationAction, type CreateOrganizationState } from "@/lib/organizations/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: CreateOrganizationState = { error: null };

const ENGAGEMENT_MODE_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: "jags_led", label: "JAGS-led", description: "JAGS branding on every document — the default." },
  { value: "co_branded", label: "Co-branded", description: "Client's branding alongside JAGS's on documents." },
  {
    value: "white_label",
    label: "White-label",
    description: "Client's own branding only. Internal JAGS traceability stays on the document, hidden from the client-visible number.",
  },
];

export function NewOrganizationForm() {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(createOrganizationAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  return (
    <form onSubmit={keepValuesSubmit} className="mt-6 max-w-lg space-y-4 rounded-lg border border-border bg-surface p-5">
      <div>
        <FormField required label="Organisation name">
          <input
          name="name"
          required
          placeholder={tl("e.g. Northgate Industries")}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div>
        <label htmlFor="org_slug" className="block text-sm font-medium text-ink">
          <Tx>Slug</Tx> <span className="font-normal text-muted"><Tx>(optional — derived from the name if left blank)</Tx></span>
        </label>
        <input
          id="org_slug"
          name="slug"
          placeholder={tl("e.g. northgate")}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div>
        <span className="block text-sm font-medium text-ink"><Tx>Engagement mode</Tx></span>
        <div className="mt-2 space-y-2">
          {ENGAGEMENT_MODE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="engagement_mode"
                value={opt.value}
                defaultChecked={opt.value === "jags_led"}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-ink">{opt.label}</span>
                <span className="block text-xs text-muted">{opt.description}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          <Tx>This can be changed later from Numbering &amp; engagement mode.</Tx>
        </p>
      </div>

      <div>
        <span className="block text-sm font-medium text-ink"><Tx>Engagement scope</Tx></span>
        <div className="mt-2 space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="engagement_scope" value="full_service" defaultChecked className="mt-1" />
            <span>
              <span className="font-medium text-ink"><Tx>Full-Managed / End-to-End Execution</Tx></span>
              <span className="block text-xs text-muted"><Tx>JAGS runs the project — the default.</Tx></span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="engagement_scope" value="self_managed" className="mt-1" />
            <span>
              <span className="font-medium text-ink"><Tx>Self-Managed (Hybrid)</Tx></span>
              <span className="block text-xs text-muted">
                <Tx>This client&apos;s own teams build, submit and accept ITPs on every project — but a JAGS staff member still has to Approve each one.</Tx>
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="engagement_scope" value="client_managed" className="mt-1" />
            <span>
              <span className="font-medium text-ink"><Tx>Full Client-Managed</Tx></span>
              <span className="block text-xs text-muted">
                <Tx>Everything Self-Managed gives, plus the client&apos;s own permission-granted people can Approve their own ITPs and create new logins for their own team — no JAGS staff involvement day-to-day after onboarding.</Tx>
              </span>
            </span>
          </label>
        </div>
      </div>

      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state.created && !state.error && (
        <p role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          <Tx>✓ Organisation “</Tx>{state.created}<Tx>” was created. It is at the top of the list below — next, add a project for it.</Tx>
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create organisation"}
      </Button>
    </form>
  );
}
