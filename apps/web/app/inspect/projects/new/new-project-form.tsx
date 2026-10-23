"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { suggestProjectNumber } from "@/lib/projects/suggest-number";
import { createProjectAction, type CreateProjectState } from "@/lib/projects/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { FormMessage } from "@/components/ui/form-message";
import { FormField } from "@/components/ui/form-field";
import { TimeZonePicker } from "@/components/domain/timezone-picker";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useAvailability } from "@/lib/hooks/use-availability";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: CreateProjectState = { error: null };

export function NewProjectForm({
  organizations,
  allowCreateOrg = true,
  staffUsers = [],
  existingNumbersByOrg = {},
}: {
  organizations: { id: string; name: string }[];
  /** Hidden for a Self-Managed client creating their own project — they can't create a new
   *  organisation, only a project under the one they already belong to. */
  allowCreateOrg?: boolean;
  /** JAGS staff who can be named as the project's responsible person (Admin only). */
  staffUsers?: { id: string; full_name: string; email: string }[];
  /** Project numbers already used, per organisation id; the next number is suggested from these. */
  existingNumbersByOrg?: Record<string, string[]>;
}) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(createProjectAction, initialState);
  const onSubmit = useKeepFormValues(state, formAction);
  // With a single organisation there is nothing to choose: preselect it and suggest the number.
  const onlyOrg = organizations.length === 1 ? organizations[0] : null;
  const [projectNumber, setProjectNumber] = useState(() =>
    onlyOrg ? suggestProjectNumber(onlyOrg.name, new Date().getFullYear(), existingNumbersByOrg[onlyOrg.id] ?? []) : ""
  );
  const [organizationId, setOrganizationId] = useState(onlyOrg?.id ?? "");
  const numberCheck = useAvailability("project_number", projectNumber, { organizationId });
  // Once the user types their own number we stop overwriting it when they change the organisation.
  const [numberEdited, setNumberEdited] = useState(false);

  function onOrganisationChange(orgId: string) {
    setOrganizationId(orgId);
    if (numberEdited) return;
    const org = organizations.find((o) => o.id === orgId);
    setProjectNumber(
      org ? suggestProjectNumber(org.name, new Date().getFullYear(), existingNumbersByOrg[org.id] ?? []) : ""
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <p className="text-xs text-muted"><span aria-hidden="true" className="text-danger">*</span> <Tx>required</Tx></p>
      <Section title={<Tx>Project details</Tx>} bodyClassName="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="organization_id" className="block text-sm font-medium text-ink">
            <Tx>Client organisation</Tx>
            <span aria-hidden="true" className="ms-0.5 text-danger">*</span>
            <span className="sr-only"> <Tx>(required)</Tx></span>
          </label>
          {allowCreateOrg && (
            <Link href="/inspect/organisation/clients" className="inline-flex min-h-9 items-center text-sm font-medium text-burgundy hover:underline">
              <Tx>+ New organisation</Tx>
            </Link>
          )}
        </div>
        <select
          id="organization_id"
          name="organization_id"
          required
          defaultValue={onlyOrg?.id ?? ""}
          aria-required="true"
          onChange={(e) => onOrganisationChange(e.target.value)}
          className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
        >
          <option value=""><Tx>Select…</Tx></option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
        {state.fieldErrors?.organization_id && (
          <p role="alert" className="mt-1 text-xs font-medium text-danger">{state.fieldErrors.organization_id}</p>
        )}
        {organizations.length === 0 && (
          <p className="mt-1 text-xs text-muted">
            <Tx>No client organisations exist yet — create one first.</Tx>
          </p>
        )}
      </div>

      <div>
        <FormField required label="Project number" error={state.fieldErrors?.project_number ?? numberCheck.message ?? undefined}>
          <input
          name="project_number"
          required
          value={projectNumber}
          onChange={(e) => {
            setProjectNumber(e.target.value);
            setNumberEdited(true);
          }}
          placeholder={tl("e.g. MER-2026-001")}
          className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
        />
        </FormField>
        <p className="mt-1 text-xs text-muted"><Tx>Suggested from the organisation and year; you can change it.</Tx></p>
      </div>

      <div>
        <FormField required label="Project name" error={state.fieldErrors?.name}>
          <input
          name="name"
          required
          placeholder={tl("e.g. Substation 3 electrical installation")}
          className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
        />
        </FormField>
      </div>

      <div>
        <FormField label="Site location">
          <input
          name="site_location"
          placeholder={tl("e.g. Jebel Ali, Dubai")}
          className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
        />
        </FormField>
      </div>

      </Section>

      <Section title={<Tx>Schedule and site</Tx>} bodyClassName="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <FormField label="Country (optional)">
            <input name="country" placeholder={tl("e.g. United Arab Emirates")} className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm" />
          </FormField>
        </div>
        <div>
          <FormField label="Contract number (optional)">
            <input name="contract_number" placeholder={tl("e.g. C-2026-014")} className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm" />
          </FormField>
        </div>
        <div>
          <FormField label="Start date (optional)">
            <input name="start_date" type="date" className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm" />
          </FormField>
        </div>
        <div>
          <FormField label="End date (optional)" error={state.fieldErrors?.end_date}>
            <input name="end_date" type="date" className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm" />
          </FormField>
        </div>
        <div>
          <FormField label="Site time zone (optional)">
            <TimeZonePicker blankLabel={tl("Default (UTC)")} className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm" />
          </FormField>
        </div>
        <div>
          <FormField label="Status">
            <select name="status" defaultValue="active" className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm">
            <option value="draft"><Tx>Draft</Tx></option>
            <option value="active"><Tx>Active</Tx></option>
            <option value="on_hold"><Tx>On hold</Tx></option>
          </select>
          </FormField>
        </div>
      </div>
      <div>
        <label htmlFor="locations" className="block text-sm font-medium text-ink">
          <Tx>Inspection locations (optional, one per line)</Tx>
        </label>
        <textarea id="locations" name="locations" rows={3} placeholder={"Block A\nBlock B\nPump house"} className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm" />
        <p className="mt-1 text-xs text-muted"><Tx>These appear in the location dropdown when an inspection is started on this project.</Tx></p>
      </div>
      </Section>

      {staffUsers.length > 0 && (
        <Section title={<Tx>Responsibility</Tx>}>
        <div>
          <FormField label="Responsible person (optional)">
            <select name="responsible_person_id" defaultValue="" className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm">
            <option value=""><Tx>— none set —</Tx></option>
            {staffUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} ({u.email})
              </option>
            ))}
          </select>
          </FormField>
        </div>
        </Section>
      )}

      <FormMessage error={state.error} />

      <StickyActionBar>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create project"}
        </Button>
        <Link href="/inspect/projects" className={buttonVariants({ variant: "link-muted" })}>
          <Tx>Cancel</Tx>
        </Link>
      </StickyActionBar>
    </form>
  );
}
