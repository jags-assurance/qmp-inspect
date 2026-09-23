"use client";

import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  addClientTeamMemberAction,
  addClientTeamMemberByEmailAction,
  removeClientTeamMemberAction,
  setClientTeamLeadAction,
  assignClientTeamToProjectAction,
  unassignClientTeamFromProjectAction,
  type ClientTeamActionState,
} from "@/lib/client-teams/actions";

const initialState: ClientTeamActionState = { error: null };

export interface UserOption {
  id: string;
  full_name: string;
  email: string;
}

export interface ProjectOption {
  id: string;
  name: string;
}

export interface ClientTeamCardData {
  id: string;
  name: string;
  canManage: boolean;
  members: { userId: string; fullName: string; email: string; isTeamLead: boolean }[];
  assignedProjects: { projectId: string; name: string }[];
}

export function ClientTeamCard({
  team,
  users,
  projects,
}: {
  team: ClientTeamCardData;
  users: UserOption[];
  projects: ProjectOption[];
}) {
  const memberIds = new Set(team.members.map((m) => m.userId));
  const availableUsers = users.filter((u) => !memberIds.has(u.id));

  const assignedIds = new Set(team.assignedProjects.map((p) => p.projectId));
  const availableProjects = projects.filter((p) => !assignedIds.has(p.id));

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium text-ink">{team.name}</h2>
        {!team.canManage && <span className="text-xs text-muted">View only</span>}
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Members</p>
        <ul className="mt-2 space-y-1.5">
          {team.members.map((m) => (
            <MemberRow key={m.userId} clientTeamId={team.id} member={m} canManage={team.canManage} />
          ))}
          {team.members.length === 0 && <li className="text-sm text-muted">No members yet.</li>}
        </ul>
        {team.canManage && <AddMemberForm clientTeamId={team.id} users={availableUsers} />}
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Assigned projects</p>
        <ul className="mt-2 space-y-1.5">
          {team.assignedProjects.map((p) => (
            <AssignedProjectRow key={p.projectId} clientTeamId={team.id} project={p} canManage={team.canManage} />
          ))}
          {team.assignedProjects.length === 0 && <li className="text-sm text-muted">No projects assigned.</li>}
        </ul>
        {team.canManage && availableProjects.length > 0 && (
          <AssignProjectForm clientTeamId={team.id} projects={availableProjects} />
        )}
      </div>
    </div>
  );
}

function MemberRow({
  clientTeamId,
  member,
  canManage,
}: {
  clientTeamId: string;
  member: { userId: string; fullName: string; email: string; isTeamLead: boolean };
  canManage: boolean;
}) {
  const [leadState, leadAction, leadPending] = useActionState(setClientTeamLeadAction, initialState);
  const [removeState, removeAction, removePending] = useActionState(removeClientTeamMemberAction, initialState);

  return (
    <li className="flex items-center justify-between text-sm">
      <span className="text-ink">
        {member.fullName} <span className="text-muted">({member.email})</span>
      </span>
      <span className="flex items-center gap-2">
        {member.isTeamLead && <Badge tone="success">Team lead</Badge>}
        {canManage && (
          <>
            <form action={leadAction} className="inline">
              <input type="hidden" name="client_team_id" value={clientTeamId} />
              <input type="hidden" name="user_id" value={member.userId} />
              <input type="hidden" name="is_team_lead" value={member.isTeamLead ? "" : "on"} />
              <button type="submit" disabled={leadPending} className="text-xs text-burgundy hover:underline disabled:opacity-50">
                {member.isTeamLead ? "Unset lead" : "Make lead"}
              </button>
            </form>
            <form action={removeAction} className="inline">
              <input type="hidden" name="client_team_id" value={clientTeamId} />
              <input type="hidden" name="user_id" value={member.userId} />
              <button type="submit" disabled={removePending} className="text-xs text-danger hover:underline disabled:opacity-50">
                Remove
              </button>
            </form>
          </>
        )}
      </span>
      {(leadState.error || removeState.error) && (
        <span className="ml-2 text-xs text-danger">{leadState.error ?? removeState.error}</span>
      )}
    </li>
  );
}

/**
 * Two ways to add someone, since "pick from the dropdown" only ever offered people who already had
 * platform access reaching this organisation — a genuinely new colleague (a real login, never yet
 * put on a project here) had no way onto their own team at all. Starts on the dropdown when there's
 * anyone eligible to pick from (the common case — reassigning/re-organising existing people), with
 * "Add by email instead" always available as the other path.
 */
function AddMemberForm({ clientTeamId, users }: { clientTeamId: string; users: UserOption[] }) {
  const [mode, setMode] = useState<"pick" | "email">(users.length > 0 ? "pick" : "email");
  const [pickState, pickAction, pickPending] = useActionState(addClientTeamMemberAction, initialState);
  const [emailState, emailAction, emailPending] = useActionState(addClientTeamMemberByEmailAction, initialState);

  if (mode === "pick") {
    return (
      <form action={pickAction} className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border bg-off-white p-2">
        <input type="hidden" name="client_team_id" value={clientTeamId} />
        {users.length > 0 ? (
          <select
            name="user_id"
            required
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-burgundy"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} ({u.email})
              </option>
            ))}
          </select>
        ) : (
          <p className="text-xs text-muted">No one else with access here yet to pick from.</p>
        )}
        <label className="flex items-center gap-1 text-xs text-ink">
          <input type="checkbox" name="is_team_lead" /> Team lead
        </label>
        {users.length > 0 && (
          <Button type="submit" size="sm" disabled={pickPending}>
            {pickPending ? "Adding…" : "+ Add member"}
          </Button>
        )}
        <button type="button" onClick={() => setMode("email")} className="text-xs text-burgundy hover:underline">
          Add by email instead
        </button>
        {pickState.error && <span className="w-full text-xs text-danger">{pickState.error}</span>}
      </form>
    );
  }

  return (
    <form action={emailAction} className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border bg-off-white p-2">
      <input type="hidden" name="client_team_id" value={clientTeamId} />
      <input
        name="email"
        type="email"
        required
        placeholder="person@company.com"
        className="rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-burgundy"
      />
      <label className="flex items-center gap-1 text-xs text-ink">
        <input type="checkbox" name="is_team_lead" /> Team lead
      </label>
      <Button type="submit" size="sm" disabled={emailPending}>
        {emailPending ? "Adding…" : "+ Add member"}
      </Button>
      {users.length > 0 && (
        <button type="button" onClick={() => setMode("pick")} className="text-xs text-burgundy hover:underline">
          Pick from existing instead
        </button>
      )}
      {emailState.error && <span className="w-full text-xs text-danger">{emailState.error}</span>}
    </form>
  );
}

function AssignedProjectRow({
  clientTeamId,
  project,
  canManage,
}: {
  clientTeamId: string;
  project: { projectId: string; name: string };
  canManage: boolean;
}) {
  const [state, formAction, pending] = useActionState(unassignClientTeamFromProjectAction, initialState);

  return (
    <li className="flex items-center justify-between text-sm">
      <span className="text-ink">{project.name}</span>
      {canManage && (
        <form action={formAction} className="inline">
          <input type="hidden" name="client_team_id" value={clientTeamId} />
          <input type="hidden" name="project_id" value={project.projectId} />
          <button type="submit" disabled={pending} className="text-xs text-danger hover:underline disabled:opacity-50">
            Unassign
          </button>
        </form>
      )}
      {state.error && <span className="ml-2 text-xs text-danger">{state.error}</span>}
    </li>
  );
}

function AssignProjectForm({ clientTeamId, projects }: { clientTeamId: string; projects: ProjectOption[] }) {
  const [state, formAction, pending] = useActionState(assignClientTeamToProjectAction, initialState);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border bg-off-white p-2">
      <input type="hidden" name="client_team_id" value={clientTeamId} />
      <select
        name="project_id"
        required
        className="rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-burgundy"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Assigning…" : "+ Assign project"}
      </Button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
