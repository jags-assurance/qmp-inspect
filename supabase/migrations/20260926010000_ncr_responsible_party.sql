-- R68: NCRs had no vendor/party FK, so an "NCR count per vendor" rollup could never be built the
-- same way computeQualityByParty (apps/web/lib/kpis/compute.ts) already rolls up sign-off
-- completion per project_parties.id -- there was simply no column linking an ncrs row back to the
-- project_parties row it's actually about. Nullable: an NCR raised standalone or from a walkdown
-- often has no specific responsible party at the moment it's raised, and this must never be
-- guessed at -- it's only ever set when a human actually picks one on the create/edit form (see
-- lib/ncrs/actions.ts's createNcrAction / updateNcrAction).
alter table public.ncrs add column responsible_party_id uuid references public.project_parties (id);

create index ncrs_responsible_party_id_idx on public.ncrs (responsible_party_id);
