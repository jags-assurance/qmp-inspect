-- Cost/latency optimization: every AI feature already requires a human review/confirm step before
-- its output takes effect anywhere (recordAiReviewDecision, 20260920030000_ai_audit_trail.sql), so
-- re-generating from byte-identical grounding input (the same pasted certificate text re-submitted,
-- the same ITP title translated to the same language twice, "clean up" clicked again on unchanged
-- text, ...) buys nothing but a second API bill and a second round-trip. This lets a server action
-- skip the actual provider call when this exact (organisation, feature, prompt_version, input_hash)
-- combination was already produced — see lib/ai/cache.ts.
--
-- input_hash is a sha256 of the feature's own normalized grounding input (never the whole prompt
-- text, which also carries date/locale boilerplate that shouldn't defeat a cache hit). Scoped by
-- prompt_version too, so bumping PROMPT_VERSIONS (gemini-provider.ts) for a wording change
-- naturally invalidates every prior cache entry for that feature — nothing to remember to clear by
-- hand. served_from_cache records whether this particular row's ai_response was actually produced by
-- a fresh call or reused, purely for later cost-accounting visibility; every row still gets logged
-- and still gets its own independent review-decision closure regardless (a cache hit changes WHEN
-- the text was produced, never whether a person reviews it before it's used).
alter table public.ai_usage_log
  add column input_hash text,
  add column served_from_cache boolean not null default false;

create index ai_usage_log_cache_lookup_idx
  on public.ai_usage_log (organization_id, feature, prompt_version, input_hash)
  where input_hash is not null;
