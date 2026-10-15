"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  addTeamMemberAction,
  removeTeamMemberAction,
  setTeamLeadAction,
  assignTeamToProjectAction,
  unassignTeamFromProjectAction,
  type TeamActionState,
} from "@/lib/teams/actions";
import { Tx } from "@/components/domain/tx";

const initialState: TeamActionState = { error: null };

export interface StaffOption {
  id: string;
  full_name: string;
  email: string;
}

export interface ProjectOption {
  id: string;
  name: string;
}

export interface TeamCardData {
  id: string;
  name: string;
  canManage: boolean;
  members: { userId: string; fullName: string; email: string; isTeamLead: boolean }[];
  assignedProjects: { projectId: string; name: string }[];
}

export function TeamCard({
  team,
  staff,
  projects,
}: {
  team: TeamCardData;
  staff: StaffOption[];
  projects: ProjectOption[];
}) {
  const memberIds = new Set(team.members.map((m) => m.userId));
  const availableStaff = staff.filter((s) => !memberIds.has(s.id));

  const assignedIds = new Set(team.assignedProjects.map((p) => p.projectId));
  const availableProjects = projects.filter((p) => !assignedIds.has(p.id));

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-medium text-ink">{team.name}</h2>
          <Badge tone="neutral">
            {team.members.length} <Tx>member</Tx>{team.members.length === 1 ? "" : "s"}
          </Badge>
          <Badge tone="neutral">
            {team.assignedProjects.length} <Tx>project</Tx>{team.assignedProjects.length === 1 ? "" : "s"}
          </Badge>
        </div>
        {!team.canManage && <span className="text-xs text-muted"><Tx>View only</Tx></span>}
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted"><Tx>Members</Tx></p>
        <ul className="mt-2 space-y-1.5">
          {team.members.map((m) => (
            <MemberRow key={m.userId} teamId={team.id} member={m} canManage={team.canManage} />
          ))}
          {team.members.length === 0 && <li className="text-sm text-muted"><Tx>No members yet.</Tx></li>}
        </ul>
        {team.canManage && availableStaff.length > 0 && (
          <AddMemberForm teamId={team.id} staff={availableStaff} />
        )}
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted"><Tx>Assigned projects</Tx></p>
        <ul className="mt-2 space-y-1.5">
          {team.assignedProjects.map((p) => (
            <AssignedProjectRow key={p.projectId} teamId={team.id} project={p} canManage={team.canManage} />
          ))}
          {team.assignedProjects.length === 0 && <li className="text-sm text-muted"><Tx>No projects assigned.</Tx></li>}
        </ul>
        {team.canManage && availableProjects.length > 0 && (
          <AssignProjectForm teamId={team.id} projects={availableProjects} />
        )}
      </div>
    </div>
  );
}

function MemberRow({
  teamId,
  member,
  canManage,
}: {
  teamId: string;
  member: { userId: string; fullName: string; email: string; isTeamLead: boolean };
  canManage: boolean;
}) {
  const [leadState, leadAction, leadPending] = useActionState(setTeamLeadAction, initialState);
  const [removeState, removeAction, removePending] = useActionState(removeTeamMemberAction, initialState);

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
      <span className="min-w-0 text-ink [overflow-wrap:anywhere]">
        {member.fullName} <span className="text-muted">({member.email})</span>
      </span>
      <span className="flex items-center gap-2">
        {member.isTeamLead && <Badge tone="success"><Tx>Team lead</Tx></Badge>}
        {canManage && (
          <>
            <form action={leadAction} className="inline">
              <input type="hidden" name="team_id" value={teamId} />
              <input type="hidden" name="user_id" value={member.userId} />
              <input type="hidden" name="is_team_lead" value={member.isTeamLead ? "" : "on"} />
              <Button type="submit" disabled={leadPending} variant="link" size="sm">
                {member.isTeamLead ? "Unset lead" : "Make lead"}
              </Button>
            </form>
            <form action={removeAction} className="inline">
              <input type="hidden" name="team_id" value={teamId} />
              <input type="hidden" name="user_id" value={member.userId} />
              <Button type="submit" disabled={removePending} variant="link-danger" size="sm">
                <Tx>Remove</Tx>
              </Button>
            </form>
          </>
        )}
      </span>
      {(leadState.error || removeState.error) && (
        <span className="ms-2 text-xs text-danger">{leadState.error ?? removeState.error}</span>
      )}
    </li>
  );
}

function AddMemberForm({ teamId, staff }: { teamId: string; staff: StaffOption[] }) {
  const [state, formAction, pending] = useActionState(addTeamMemberAction, initialState);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border bg-off-white p-2">
      <input type="hidden" name="team_id" value={teamId} />
      <select
        name="user_id"
        required
        className="rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-burgundy"
      >
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.full_name} ({s.email})
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-ink">
        <input type="checkbox" name="is_team_lead" /> <Tx>Team lead</Tx>
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "+ Add member"}
      </Button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}

function AssignedProjectRow({
  teamId,
  project,
  canManage,
}: {
  teamId: string;
  project: { projectId: string; name: string };
  canManage: boolean;
}) {
  const [state, formAction, pending] = useActionState(unassignTeamFromProjectAction, initialState);

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
      <span className="min-w-0 text-ink [overflow-wrap:anywhere]">{project.name}</span>
      {canManage && (
        <form action={formAction} className="inline">
          <input type="hidden" name="team_id" value={teamId} />
          <input type="hidden" name="project_id" value={project.projectId} />
          <Button type="submit" disabled={pending} variant="link-danger" size="sm">
            <Tx>Unassign</Tx>
          </Button>
        </form>
      )}
      {state.error && <span className="ms-2 text-xs text-danger">{state.error}</span>}
    </li>
  );
}

function AssignProjectForm({ teamId, projects }: { teamId: string; projects: ProjectOption[] }) {
  const [state, formAction, pending] = useActionState(assignTeamToProjectAction, initialState);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border bg-off-white p-2">
      <input type="hidden" name="team_id" value={teamId} />
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
