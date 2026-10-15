"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { addProjectPartyAction, listOrganisationPartiesAction, type AddProjectPartyState } from "@/lib/projects/actions";
import type { ReusableParty } from "@/lib/projects/reusable-parties";
import { provisionPartyLoginAction, searchExistingPeopleAction, type ExistingPersonMatch } from "@/lib/projects/party-provisioning";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: AddProjectPartyState = { error: null };

const PARTY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "client", label: "Client" },
  { value: "main_contractor", label: "Main Contractor" },
  { value: "subcontractor", label: "Subcontractor" },
  { value: "tpi_lab", label: "TPI / Lab" },
  { value: "vendor", label: "Vendor" },
  { value: "jags", label: "JAGS Assurance" },
];

export function AddProjectPartyForm({ projectId, canGrantAccess = false }: { projectId: string; canGrantAccess?: boolean }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(addProjectPartyAction, initialState);
  const [partyType, setPartyType] = useState(PARTY_TYPE_OPTIONS[0].value);
  const [partyName, setPartyName] = useState("");
  const [reusable, setReusable] = useState<ReusableParty[]>([]);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<ExistingPersonMatch[]>([]);
  const [picked, setPicked] = useState(false);
  const [grantNow, setGrantNow] = useState(false);
  const [grantResult, setGrantResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [, startTransition] = useTransition();
  const handled = useRef<string | null>(null);

  // Parties already used on this organisation's other projects, so the same company is picked, not retyped.
  useEffect(() => {
    let cancelled = false;
    listOrganisationPartiesAction(projectId)
      .then((list) => {
        if (!cancelled) setReusable(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, state.partyId]);

  // Type-ahead over people who already have an account (Admin only; two characters minimum).
  const searchActive = canGrantAccess && !picked && search.trim().length >= 2;
  const visibleMatches = searchActive ? matches : [];
  useEffect(() => {
    if (!searchActive) return;
    const timer = setTimeout(() => {
      searchExistingPeopleAction(search).then(setMatches).catch(() => setMatches([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [search, searchActive]);

  // After the party is created, optionally link the person's account to it right away. An existing
  // account is linked as-is (no new password); only an unknown email would create a login, and that
  // still goes through the same audited action as "Grant platform access".
  useEffect(() => {
    if (!state.partyId || handled.current === state.partyId) return;
    handled.current = state.partyId;
    setGrantResult(null);
    const email = contactEmail.trim();
    if (grantNow && picked && email) {
      const fd = new FormData();
      fd.set("project_party_id", state.partyId);
      fd.set("email", email);
      startTransition(async () => {
        const result = await provisionPartyLoginAction({ error: null, tempPassword: null, email: null }, fd);
        if (result.error) setGrantResult({ ok: false, text: `Party added, but access was not granted: ${result.error}` });
        else if (result.tempPassword) setGrantResult({ ok: false, text: `Party added. Unexpectedly a new account was created for ${email} and its temporary password is not shown here: reset it from the sign-in page's Forgot password.` });
        else setGrantResult({ ok: true, text: `Party added and ${email} was linked with their existing account. No new password needed.` });
      });
    }
    setPartyName("");
    setContactName("");
    setContactEmail("");
    setSearch("");
    setPicked(false);
    setGrantNow(false);
  }, [state.partyId, grantNow, picked, contactEmail]);

  return (
    <form action={formAction} className="mt-4 space-y-3 rounded-md border border-dashed border-border bg-off-white p-3">
      <input type="hidden" name="project_id" value={projectId} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {reusable.length > 0 && (
          <div className="sm:col-span-2">
            <label htmlFor="reuse_party" className="block text-xs font-medium text-ink">
              <Tx>Already used in this organisation? Reuse a party</Tx> <span className="font-normal text-muted"><Tx>(fills in the details below)</Tx></span>
            </label>
            <select
              id="reuse_party"
              value=""
              onChange={(e) => {
                const p = reusable[Number(e.target.value)];
                if (!p) return;
                setPartyType(p.partyType);
                setPartyName(p.name);
                setContactName(p.contactName ?? "");
                setContactEmail(p.contactEmail ?? "");
                setPicked(false);
                setGrantNow(false);
              }}
              className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
            >
              <option value="">{tl("Choose a party from this organisation's other projects…")}</option>
              {reusable.map((p, i) => (
                <option key={`${p.partyType}-${p.name}`} value={i}>
                  {`${p.name} - ${PARTY_TYPE_OPTIONS.find((o) => o.value === p.partyType)?.label ?? p.partyType} (${p.projectCount} ${p.projectCount === 1 ? "project" : "projects"})`}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <FormField label="Party type" error={state.fieldErrors?.party_type}>
            <select
            name="party_type"
            required
            value={partyType}
            onChange={(e) => setPartyType(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          >
            {PARTY_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          </FormField>
        </div>
        <div>
          <FormField label="Organisation / company name" error={state.fieldErrors?.name}>
            <input
            name="name"
            required
            value={partyName}
            onChange={(e) => setPartyName(e.target.value)}
            placeholder={tl("e.g. Voltway Electrical Ltd")}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
          </FormField>
        </div>
        {canGrantAccess && (
          <div className="relative sm:col-span-2">
            <label htmlFor="existing_person" className="block text-xs font-medium text-ink">
              <Tx>Already on another project? Find the person</Tx> <span className="font-normal text-muted"><Tx>(optional: name or email)</Tx></span>
            </label>
            <input
              id="existing_person"
              type="search"
              autoComplete="off"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPicked(false);
              }}
              placeholder={tl("Start typing a name or email")}
              className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
            />
            {visibleMatches.length > 0 && (
              <ul role="listbox" className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-surface shadow-md">
                {visibleMatches.map((m) => (
                  <li key={m.email}>
                    <button
                      type="button"
                      role="option"
                      aria-selected="false"
                      onClick={() => {
                        setContactName(m.name);
                        setContactEmail(m.email);
                        setSearch(`${m.name} (${m.email})`);
                        setPicked(true);
                        setGrantNow(true);
                        setMatches([]);
                      }}
                      className="block min-h-11 w-full px-3 py-1.5 text-left text-sm hover:bg-off-white"
                    >
                      <span className="font-medium text-ink">{m.name}</span> <span className="text-muted">{m.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div>
          <label htmlFor="contact_name" className="block text-xs font-medium text-ink">
            <Tx>Contact name</Tx> <span className="font-normal text-muted"><Tx>(optional)</Tx></span>
          </label>
          <input
            id="contact_name"
            name="contact_name"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>
        <div>
          <label htmlFor="contact_email" className="block text-xs font-medium text-ink">
            <Tx>Contact email</Tx> <span className="font-normal text-muted"><Tx>(optional)</Tx></span>
          </label>
          <input
            id="contact_email"
            name="contact_email"
            type="email"
            value={contactEmail}
            onChange={(e) => {
              setContactEmail(e.target.value);
              setPicked(false);
            }}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>
        <div>
          <span className="block text-xs font-medium text-ink"><Tx>Onboarded by</Tx></span>
          <div className="mt-1 flex items-center gap-4 text-sm text-ink">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="onboarded_by" value="jags" defaultChecked /> <Tx>JAGS</Tx>
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="onboarded_by" value="client" /> <Tx>Client</Tx>
            </label>
          </div>
        </div>
      </div>

      {canGrantAccess && picked && (
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={grantNow} onChange={(e) => setGrantNow(e.target.checked)} className="mt-0.5" />
          <span>
            <Tx>Give this person access to the project now</Tx>
            <span className="block text-xs text-muted">
              <Tx>They already have an account, so it is linked as-is: no new password and no new login. For someone without an account use Grant platform access on the party row.</Tx>
            </span>
          </span>
        </label>
      )}

      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {grantResult && (
        <p role={grantResult.ok ? "status" : "alert"} className={`rounded-md border px-3 py-2 text-sm ${grantResult.ok ? "border-success/30 bg-success/5 text-success" : "border-danger/30 bg-danger/5 text-danger"}`}>
          {grantResult.text}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "+ Add party"}
      </Button>
    </form>
  );
}
