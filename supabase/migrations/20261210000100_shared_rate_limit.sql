-- Shared (cross-instance) rate limit counter for HEAVY API routes (exports, ZIPs, PDFs, AI, inbound email).
-- The in-memory limiter in apps/web/lib/api/rate-limit.ts is per serverless instance; this adds a
-- fixed-window counter shared by all instances. Called only from server code with the service-role client.
-- Idempotent. Rollback: DROP FUNCTION public.check_rate_limit(text,int,int); DROP TABLE public.rate_limit_hits;

create table if not exists public.rate_limit_hits (
  key          text        not null,
  window_start timestamptz not null,
  count        int         not null default 0,
  primary key (key, window_start)
);

alter table public.rate_limit_hits enable row level security;
-- No policies: neither anon nor authenticated can touch it; only service_role (bypasses RLS) via the function.
revoke all on public.rate_limit_hits from anon, authenticated;

create or replace function public.check_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz;
  v_count  int;
begin
  if p_key is null or p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 then
    return true; -- malformed call: never block
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limit_hits as h (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = h.count + 1
  returning h.count into v_count;

  -- Opportunistic cleanup (~1% of calls): drop windows older than one day.
  if random() < 0.01 then
    delete from public.rate_limit_hits where window_start < now() - interval '1 day';
  end if;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;
