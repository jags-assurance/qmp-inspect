-- R104: discipline was resolvable everywhere else in the app (itp_items.discipline_id,
-- master_disciplines) but was never a configurable segment of the document numbering format
-- (numbering_configs / lib/numbering/format.ts). Adds an opt-in boolean per doc-type config that,
-- when true, inserts the resolved discipline code right after the doc-type segment — see
-- lib/numbering/format.ts's formatDocumentNumber. Defaults to false so every existing config keeps
-- generating exactly the same numbers until an Admin opts in.
alter table public.numbering_configs
  add column include_discipline boolean not null default false;

comment on column public.numbering_configs.include_discipline is
  'R104: when true, the discipline code (master_disciplines.code) resolved for the document being numbered is inserted right after the doc-type segment. Omitted (never a blank placeholder) when no discipline is resolvable for that document.';
