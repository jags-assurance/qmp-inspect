-- Real Gemini token counts per AI call, so Usage & Cost (apps/web/app/inspect/organisation/usage/
-- page.tsx) can show an actual $ cost estimate instead of just a raw call count. Populated from
-- Gemini's own usageMetadata (see apps/web/lib/ai/gemini-provider.ts's withGeminiUsage) — null for
-- any row logged before this migration, and for a cache hit (no real API call made that time).
alter table ai_usage_log
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer;

comment on column ai_usage_log.input_tokens is 'Gemini usageMetadata.promptTokenCount for this call. Null if unavailable (served from cache, or logged before this column existed).';
comment on column ai_usage_log.output_tokens is 'Gemini usageMetadata.candidatesTokenCount for this call. Null if unavailable (served from cache, or logged before this column existed).';
