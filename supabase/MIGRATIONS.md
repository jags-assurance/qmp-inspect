# Migration discipline

This project has no staging Supabase project — `pnpm db:push` (`supabase db push`) applies
directly to the real, linked project. That makes a few rules non-negotiable rather than nice-to-have:

## Forward-only

Never edit a migration file that has already been pushed, even to fix a typo. Supabase tracks
applied migrations by filename+checksum; editing one after the fact desyncs whatever environment
already applied it from one that hasn't. If a migration shipped something wrong, write a new
migration that corrects it (`alter table ... drop column`, a follow-up `update`, etc.) — never
`git commit --amend` or hand-edit the old file.

## No down-migrations — write the compensating migration instead

There's no `*.down.sql` convention here (Supabase CLI migrations are forward-only by default, and
this repo doesn't add tooling on top of that). If a migration needs to be undone, that undo is
itself a new, forward migration: e.g. the migration that added a column is undone by a new
migration that drops it, not by "rolling back" the original file. Before writing one, check
whether anything already depends on what you're removing (a view, a policy, a generated column,
application code already reading it) — `grep` the table name across `apps/web` and `worker` first.

## Before running `db:push` against the real project

1. Read the migration you're about to push start to finish — this is the actual review step,
   since there's no staging environment to catch a mistake first.
2. For anything destructive (`drop column`, `drop table`, a `not null` added to an existing
   column with existing rows, a changed `check` constraint that existing rows might violate):
   confirm via `mcp__Supabase__execute_sql` (read-only `select`) that no current row would break
   before pushing, not after.
3. RLS changes especially: a new/changed policy takes effect immediately for every connected
   client. Re-read the policy as the least-privileged role it applies to, not just as staff.

## Numbering / sequence migrations specifically

`document_sequences` (20260910020000_phase2_numbering_engine.sql) is the one atomic counter
primitive in this schema (`next_document_sequence()`), used for every sequential document/record
number in the app (ITP, NCR, checklist, INSP, IRN, standalone assignment numbers). Any new
document type that needs its own running number should reuse `next_document_sequence` with a
namespaced `seq_doc_type` key (see `lib/numbering/generate.ts`'s `nextSequenceNumber`) rather than
a fresh `select count(*) ... then insert`, which races under concurrent writes — the exact bug
this table was introduced to eliminate.
