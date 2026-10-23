"use client";

import { useActionState, useState } from "react";
import {
  addPartyMemberAction,
  removePartyMemberAction,
  setPartyAccessModeAction,
  type PartyMemberActionState,
} from "@/lib/projects/party-access-actions";
import { Badge } from "@/components/ui/badge";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const INITIAL_STATE: PartyMemberActionState = { error: null };

export interface PartyMemberRow {
  id: string;
  user_id: string | null;
  invited_email: string | null;
  permission_mode: "standard" | "custom";
  custom_role_id: string | null;
  users: { full_name: string; email: string } | null;
  custom_roles: { name: string } | null;
}

export interface CustomRoleOption {
  id: string;
  name: string;
}

/**
 * The "give access to specific people from a party, or the whole party, with an optional custom
 * permission per person" affordance — sits below the existing per-party row (name/type/primary
 * contact/Reassign/Grant platform access) rather than replacing any of it. project_parties.user_id
 * stays "the primary contact" exactly as it works today; everything here is the ADDITIONAL layer of
 * project_party_members (20260930180000_project_party_members.sql).
 *
 * Collapsed by default (a "Members" toggle) so a party with nobody added yet doesn't visually bloat
 * every row on a project with many parties — matches ReassignPartyForm/ProvisionPartyLoginForm's
 * own click-to-expand pattern.
 */
export function PartyMembersPanel({
  projectPartyId,
  accessMode,
  members,
  customRoles,
  primaryContactUserId,
}: {
  projectPartyId: string;
  accessMode: "whole_org" | "selected_people";
  members: PartyMemberRow[];
  customRoles: CustomRoleOption[];
  primaryContactUserId: string | null;
}) {
  const tl = useTranslate();
  const [open, setOpen] = useState(false);
  const [modeState, modeAction, modePending] = useActionState(setPartyAccessModeAction, INITIAL_STATE);
  const [addState, addAction, addPending] = useActionState(addPartyMemberAction, INITIAL_STATE);
  const keepAddSubmit = useKeepFormValues(addState, addAction);
  const [permissionMode, setPermissionMode] = useState<"standard" | "custom">("standard");

  const extraMembers = members.filter((m) => m.user_id !== primaryContactUserId);

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} variant="link">
        <Tx>Members</Tx>{extraMembers.length > 0 ? ` (${extraMembers.length})` : ""}
      </Button>
    );
  }

  return (
    <div className="mt-2 w-full rounded-md border border-border bg-off-white p-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-muted"><Tx>Access mode:</Tx></span>
          <form action={modeAction} className="flex items-center gap-1">
            <input type="hidden" name="project_party_id" value={projectPartyId} />
            <select
              name="access_mode"
              defaultValue={accessMode}
              disabled={modePending}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="rounded border border-border bg-surface px-1 py-0.5 text-xs outline-none focus:border-burgundy"
            >
              <option value="whole_org"><Tx>Whole organisation</Tx></option>
              <option value="selected_people"><Tx>Selected people only</Tx></option>
            </select>
          </form>
        </div>
        <Button type="button" onClick={() => setOpen(false)} variant="link-muted">
          <Tx>Close</Tx>
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted">
        {accessMode === "whole_org"
          ? "Anyone added below gets this party's standard access automatically."
          : "Only the people listed below get access — nobody else is implied."}
      </p>
      {modeState.error && <p role="alert" className="mt-1 text-danger">{modeState.error}</p>}

      <ul className="mt-2 space-y-1">
        {extraMembers.length === 0 && <li className="text-muted"><Tx>No additional members yet.</Tx></li>}
        {extraMembers.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-2 py-1">
            <span className="text-ink">
              {m.users ? `${m.users.full_name} (${m.users.email})` : `${m.invited_email} (invited, no account yet)`}
            </span>
            <span className="flex items-center gap-1.5">
              <Badge tone={m.permission_mode === "custom" ? "info" : "neutral"}>
                {m.permission_mode === "custom" ? m.custom_roles?.name ?? "Custom" : "Standard"}
              </Badge>
              <RemoveMemberButton memberId={m.id} />
            </span>
          </li>
        ))}
      </ul>

      <form onSubmit={keepAddSubmit} className="mt-2 flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="project_party_id" value={projectPartyId} />
        <input aria-label={tl("person@company.com")}
          name="email"
          type="email"
          required
          aria-invalid={addState.fieldErrors?.email ? true : undefined}
          placeholder={tl("person@company.com")}
          className="w-40 rounded border border-border bg-surface px-1.5 py-1 text-xs outline-none focus:border-burgundy"
        />
        <select
          name="permission_mode"
          value={permissionMode}
          onChange={(e) => setPermissionMode(e.target.value as "standard" | "custom")}
          className="rounded border border-border bg-surface px-1 py-1 text-xs outline-none focus:border-burgundy"
        >
          <option value="standard"><Tx>Standard access</Tx></option>
          <option value="custom"><Tx>Custom permission</Tx></option>
        </select>
        {permissionMode === "custom" && (
          <select
            name="custom_role_id"
            required
            aria-invalid={addState.fieldErrors?.custom_role_id ? true : undefined}
            className="rounded border border-border bg-surface px-1 py-1 text-xs outline-none focus:border-burgundy"
          >
            <option value=""><Tx>— choose role —</Tx></option>
            {customRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            {customRoles.length === 0 && <option value=""><Tx>No custom roles for this org yet</Tx></option>}
          </select>
        )}
        <Button type="submit" disabled={addPending} variant="link">
          {addPending ? "Adding…" : "Add"}
        </Button>
        {addState.error && <span role="alert" className="w-full text-danger">{addState.fieldErrors?.email ?? addState.fieldErrors?.custom_role_id ?? addState.error}</span>}
      </form>
    </div>
  );
}

function RemoveMemberButton({ memberId }: { memberId: string }) {
  const [state, formAction, pending] = useActionState(removePartyMemberAction, INITIAL_STATE);
  const keepValuesSubmit = useKeepFormValues(state, formAction);
  return (
    <form onSubmit={keepValuesSubmit}>
      <input type="hidden" name="member_id" value={memberId} />
      <Button type="submit" disabled={pending} variant="link-danger">
        {pending ? "Removing…" : "Remove"}
      </Button>
      {state.error && <span className="ms-1 text-danger">{state.error}</span>}
    </form>
  );
}
