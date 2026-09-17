# Incident Response Runbook (Minimal)

_Last reviewed: 2026-09-17. This is a working runbook for the QMP Inspect platform, not a legal
document. Anything below marked "needs legal review" is a placeholder for a commitment that must
be signed off by legal/compliance before it is presented to customers or prospects._

## Scope

A security incident, for this purpose, is any event where customer data may have been accessed,
modified, or exposed outside of its intended access boundaries — most concretely, in a multi-tenant
system like this one, a **cross-tenant or cross-project data-isolation gap**: a user or process
seeing or writing data belonging to an organisation or project they should not have access to.

## Who gets notified internally

- The engineer or reviewer who discovers or suspects the issue notifies the JAGS technical lead
  immediately, by the fastest available channel (do not wait for a scheduled meeting).
- The technical lead triages within the same working day and decides whether to escalate to
  whoever owns customer relationships, so any affected customer can be informed once the facts are
  established (see "Customer notification" below).
- For anything touching authentication, Storage, or database row-level security specifically, the
  person who owns the Supabase project should be looped in directly, since they can pull query
  logs and apply an emergency policy fix without waiting on a full deploy cycle.

## Response-time expectation (internal working target, not a customer-facing SLA)

- **Acknowledge and begin triage:** same working day the issue is reported or discovered.
- **Contain** (e.g. disable the affected feature, tighten the responsible RLS policy, revoke a
  credential): as fast as is safe to do — for a database policy fix this can realistically be
  within hours, since policy changes are plain SQL migrations, not a full application redeploy.
- **Root-cause and permanent fix:** targeted within days, depending on complexity.
These are working targets for the internal team, not a contractual commitment — see "Customer
notification" for what can and cannot be promised externally today.

## Example scenario: suspected cross-tenant / cross-project data-isolation gap

This is not hypothetical for this codebase — it is the exact class of issue found and fixed
proactively during this development cycle's own security review (see "Known past issues" below),
so this scenario is deliberately given first and in the most detail.

1. **Identify the boundary that failed.** Data isolation here is enforced through Postgres
   row-level security (RLS) policies on tables such as `background_jobs`, and through Supabase
   Storage object policies on buckets like `inspection-evidence` and `generated-documents`. Confirm
   which policy is under-scoping — e.g. a policy that checks organisation-level access
   (`has_org_access`) where it should check project-level access (`has_project_access`), or a
   policy missing entirely on a read path that exists on the corresponding write path.
2. **Contain.** Write and apply a corrective migration under `supabase/migrations/` that
   drops and recreates the affected policy with the correct scoping. This can typically ship as its
   own narrow migration without touching application code, and can go out faster than a full app
   deploy.
3. **Assess actual exposure.** Query the affected table/bucket's access logs (where available) for
   the period the gap existed, to determine whether any out-of-scope access actually occurred, and
   by whom, versus was merely possible.
4. **Fix and verify.** Confirm the new policy against representative test cases per role (staff,
   client, project-scoped subcontractor) before considering the fix complete.
5. **Decide on customer notification** based on the actual-exposure assessment in step 3 (see
   below).

## Known past issues (shown here as evidence of an active review process)

During this development cycle, a proactive internal security review identified and fixed a set of
RLS and Storage-policy scoping gaps of exactly this kind — for example, a `background_jobs` read
policy that checked platform-wide staff status without the project-level scoping its own insert
policy already had, and several Storage object policies (`inspection-evidence`,
`generated-documents`) that were still checking organisation-level access after the equivalent
database tables had already been tightened to project-level access. These were found and corrected
before this document was written, as part of routine internal review — not in response to a
reported incident or external report. They are referenced here so this runbook's example scenario
is grounded in this system's real history rather than a generic template, and as a demonstration
that this class of bug is actively hunted for, not just patched reactively.

## Customer notification

If an incident is confirmed to have resulted in actual (not merely possible) unauthorized access to
another customer's data, affected customers will be notified in plain language: what happened, what
data was involved, what was done to fix it, and what the customer should do if anything.

**Needs legal review before this document is shown to a customer or prospect:** the specific
notification *timeframe* (e.g. "within X hours/days of confirmation") is not yet a committed
number in this document and should not be treated as one — that number should be set with legal
input, likely tied to what any signed customer agreement requires, before it is stated as a
commitment.
