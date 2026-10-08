# Incident Response Runbook

_Last reviewed: 2026-10-08. This is a working runbook for the QMP Inspect platform, not a legal
document. Anything below marked "needs legal review" is a placeholder for a commitment that must
be signed off by legal/compliance before it is presented to customers or prospects._

## Scope

A security incident, for this purpose, is any event where customer data may have been accessed,
modified, or exposed outside of its intended access boundaries — most concretely, in a multi-tenant
system like this one, a **cross-tenant or cross-project data-isolation gap**: a user or process
seeing or writing data belonging to an organisation or project they should not have access to.

## Severity levels

Pick the level from the impact, not from how the problem was found. If unsure, choose the higher one and lower it once the facts are known. The incident commander (see Contacts) sets and changes the level and writes it in the incident log.

| Level | Definition | Examples | Acknowledge | Update the team / affected customers every | Target to contain |
|---|---|---|---|---|---|
| **S1 Critical** | Confirmed or likely exposure of one customer's data to another, loss or corruption of records, the whole service down, or a security compromise (leaked service key, account takeover) | Cross-tenant read or write; `SUPABASE_SERVICE_ROLE_KEY` exposed; database unreachable; wrong data wiped | 15 minutes, at any hour | 1 hour | 4 hours |
| **S2 High** | A major function is unusable or unsafe for many users, with no workaround, or data is wrong but contained | Sign-in failing for a customer; PDFs not generating for everyone; sign-off or IRN issue blocked; worker stalled (`/api/health` degraded) | 1 hour in working hours | 4 hours | 1 working day |
| **S3 Medium** | A function is degraded or has a workaround; a small group is affected | One report type failing; slow pages; emails delayed (check the `email_outbox`); one user cannot see a project | Same working day | 1 working day | 3 working days |
| **S4 Low** | Cosmetic or minor, no data or workflow impact; questions | Typo, layout glitch, a request for help | 2 working days | On resolution | Next planned release |

These are internal working targets, not a customer-facing SLA (see "Customer notification"). "At any hour" cover depends on an on-call arrangement: [OWNER TO FILL: whether out-of-hours cover exists, and who provides it]. Until it is filled, treat the S1 and S2 acknowledge targets as applying in working hours only.

## Contacts

Roles, not names, so this stays true when people change. Fill the table in and keep it current; review it at least every [OWNER TO FILL: review interval]. Store it where people can reach it when the system is down (printed or in a shared drive outside the production stack).

| Role | Responsibility | Name | Phone / out-of-hours | Email | Backup |
|---|---|---|---|---|---|
| Incident commander (JAGS technical lead) | Owns the incident: sets severity, assigns work, approves rollback or restore, decides escalation | [OWNER TO FILL] | [OWNER TO FILL] | [OWNER TO FILL] | [OWNER TO FILL] |
| Engineering on call | First responder: triage, contain, fix, roll back | [OWNER TO FILL] | [OWNER TO FILL] | [OWNER TO FILL] | [OWNER TO FILL] |
| Supabase project owner | Query logs, emergency policy fixes, backups and restore | [OWNER TO FILL] | [OWNER TO FILL] | [OWNER TO FILL] | [OWNER TO FILL] |
| Hosting owner (Vercel and Railway accounts) | Deployments, rollbacks, environment variables, secrets rotation | [OWNER TO FILL] | [OWNER TO FILL] | [OWNER TO FILL] | [OWNER TO FILL] |
| Customer relationship owner | Decides and sends customer communication | [OWNER TO FILL] | [OWNER TO FILL] | [OWNER TO FILL] | [OWNER TO FILL] |
| Data protection contact | Personal-data incidents, regulator and data-subject communication | [OWNER TO FILL] | [OWNER TO FILL] | [OWNER TO FILL] | [OWNER TO FILL] |
| Legal / compliance | Notification duties and wording | [OWNER TO FILL] | [OWNER TO FILL] | [OWNER TO FILL] | [OWNER TO FILL] |
| Executive sponsor | Informed on every S1; decides on public statements | [OWNER TO FILL] | [OWNER TO FILL] | [OWNER TO FILL] | [OWNER TO FILL] |

Vendor support routes (fill in the account and plan details; do not put secrets here): Supabase [OWNER TO FILL: support route and plan], Vercel [OWNER TO FILL], Railway [OWNER TO FILL], Resend [OWNER TO FILL], Google Cloud / Gemini [OWNER TO FILL], Sentry [OWNER TO FILL].

## Escalation

1. **Anyone** who sees or suspects an incident tells the engineering on-call contact straight away by phone or chat (not only by email) and writes down what they saw and when.
2. **Engineering on call** triages, proposes a severity and tells the incident commander at once for S1 and S2, the same day for S3.
3. **Incident commander** confirms the severity, opens an incident log (a dated document or ticket: timeline, decisions, actions, who), and pulls in the Supabase owner for anything touching authentication, Storage or row-level security, and the hosting owner for deployments and secrets.
4. **S1 or any possible personal-data exposure:** within the acknowledge target also inform the data protection contact, legal / compliance, the customer relationship owner and the executive sponsor. They decide whether and when customers and any regulator are told (see "Customer notification").
5. **No response:** if the first contact does not acknowledge within the target, the next person in the table is called; for S1 go straight to the incident commander's backup after 15 more minutes.
6. **Stand down** only when the incident commander records that the service is verified (health check, role-by-role checks; see `docs/OPERATIONS_RUNBOOK.md` section 3a "Verify after any rollback") and the review is scheduled.

Useful first moves: roll back the release (`docs/OPERATIONS_RUNBOOK.md` section 3a), disable the affected feature, deactivate an account (a JAGS Admin action: it bans the login, ends open sessions and removes access grants, which are recorded so they can be restored), rotate a leaked key in Supabase and update Vercel and Railway.

## Communication templates

Fill the square brackets. Keep to facts; no speculation, no blame, no promises about timing you cannot meet. Customer-facing text is sent only by the customer relationship owner after legal review where personal data is involved (needs legal review).

**Internal alert (chat or SMS)**
> [S1|S2|S3] incident, [short title]. Seen at [time, timezone] by [name]. Impact: [who or what is affected]. Status: [investigating|contained|fixing]. Incident commander: [name]. Next update at [time]. Do not discuss outside this channel.

**Customer: initial notice (service impact, no data exposure known)**
> Subject: Service issue with QMP Inspect, [date]
> We are aware of an issue affecting [function]. It started at about [time, timezone]. [Who is affected.] Your data [is not believed to be affected / is being checked]. You can [workaround, if any]. We will update you by [time] and when it is resolved. Contact: [support contact].

**Customer: resolved**
> Subject: Resolved: service issue with QMP Inspect, [date]
> The issue affecting [function] was resolved at [time]. Cause: [one plain sentence]. What we did: [action]. What we are doing to prevent a repeat: [action]. Any records you created during [window] [are safe / should be checked: details]. Contact: [support contact].

**Customer: confirmed unauthorised access to their data** (needs legal review before sending; the notification timeframe is not decided in this document)
> Subject: Notice about access to your data in QMP Inspect
> On [date] we found that [what happened] between [start] and [end]. The data involved was [categories of data and approximate number of records]. [Whether anything was changed.] We [fixed it / contained it] at [time] by [action]. What you should do: [action, if any]. We have [informed / will inform] [regulator, if applicable]. You can reach [data protection contact] at [email, phone] with questions.

**Regulator / data-protection authority** (drafted with legal; deadlines depend on the law that applies: [OWNER TO FILL: applicable law and notification deadline])

**Internal stand-down**
> Incident [id] is closed. Final severity [level]. Service verified at [time]. Review meeting [date, time]. Please send timeline corrections to [name] by [date].

## Post-incident review template

Hold it within [OWNER TO FILL: e.g. 5 working days] of an S1 or S2 (S3 only if it repeated or taught something). Blameless: ask what let it happen, not who did it. Keep the result with the incident log and track actions to completion.

| Section | Content |
|---|---|
| Summary | What happened, in three sentences. Final severity, duration, who was affected |
| Timeline | Time (with timezone), event, who acted. Include when it started, was detected, acknowledged, contained, resolved |
| Impact | Users, organisations, records; was any data exposed, changed or lost (state the evidence); customer and regulator notifications made |
| Root cause | The technical cause and the conditions that allowed it (missing test, policy scoping, review gap, monitoring gap) |
| Detection | How it was found, how long it ran unnoticed, what would have found it sooner |
| Response | What worked, what was slow or unclear (contacts, access, runbook steps, rollback) |
| What we got lucky with | Things that limited the damage by chance |
| Actions | Action, owner, due date, link. Types: prevent, detect, respond, document |
| Follow-up check | Date the actions were verified done, and by whom |

## Error tracking

Sentry is scaffolded in both the web app (`apps/web/instrumentation.ts`,
`instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`) and the worker
(`worker/src/index.ts`) — but genuinely inactive until `SENTRY_DSN` (and, for the browser,
`NEXT_PUBLIC_SENTRY_DSN`) is set, since no Sentry account/project exists yet. Until then, this
runbook's "who finds out about a production error" story is still exactly what it was before:
whatever a person notices, plus the console logs each service already writes (`[worker] ...` lines
in Railway's log viewer, `console.error` in Next.js's server logs) — nothing pushes a notification
anywhere. Setting up the real Sentry project and both DSNs closes that gap; until then, do not
assume errors are being tracked anywhere they aren't explicitly logged.

PII scrubbing is already wired in, so setting the DSNs needs no further code change: every web
(server, edge, browser) and worker event passes through `scrubEvent` (`beforeSend` and
`beforeSendTransaction`), breadcrumbs are dropped, and `sendDefaultPii` is off. User, cookies,
headers, request bodies and stack-frame variables are removed, and emails, bearer tokens, JWTs,
`token=`/`password=`-style parameters and `/verify/<kind>/<token>` links are masked in text, URLs,
transaction names and spans (`apps/web/lib/observability/scrub.ts`; the worker keeps a tested copy
in `worker/src/observability/scrub.ts`). Check one real event in Sentry after the first deploy.

## Who gets notified internally

- The engineer or reviewer who discovers or suspects the issue notifies the JAGS technical lead
  immediately, by the fastest available channel (see the Contacts table above) (do not wait for a scheduled meeting).
- The technical lead triages within the same working day and decides whether to escalate to
  whoever owns customer relationships, so any affected customer can be informed once the facts are
  established (see "Customer notification" below).
- For anything touching authentication, Storage, or database row-level security specifically, the
  person who owns the Supabase project should be looped in directly, since they can pull query
  logs and apply an emergency policy fix without waiting on a full deploy cycle.

## Response-time expectation (internal working target, not a customer-facing SLA)

The severity table above sets the per-level targets; the general expectations below apply to anything not yet classified.


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
