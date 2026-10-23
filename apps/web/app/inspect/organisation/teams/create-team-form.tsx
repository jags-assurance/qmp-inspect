"use client";

import { useActionState } from "react";
import { createTeamAction, type TeamActionState } from "@/lib/teams/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: TeamActionState = { error: null };

export function CreateTeamForm() {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(createTeamAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  return (
    <form onSubmit={keepValuesSubmit} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-off-white p-4">
      <div>
        <FormField required label="Team name">
          <input
          name="name"
          required
          placeholder={tl("e.g. North Region Field Team")}
          className="mt-1 w-64 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "+ Create team"}
      </Button>
      {state.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
