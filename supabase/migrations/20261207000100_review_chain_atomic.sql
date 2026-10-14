-- Audit fix ITP lifecycle M2: starting a review chain used to delete the old steps and insert the new
-- ones as two un-checked statements. If the insert failed the ITP sat under_review with no chain and the
-- app treated that as "no chain configured" (single-click approve), silently bypassing the hierarchy.
-- replace_itp_review_steps(itp, steps) swaps the steps in ONE transaction: all-or-nothing.
--   p_steps: jsonb array of {"reviewer_user_id": uuid, "sort_order": int}, non-empty, no duplicate reviewers.
-- Only JAGS staff (same rule as the itp_review_progress insert policy) and only while the ITP is under_review.
-- Idempotent (create or replace).
-- Rollback: drop function if exists public.replace_itp_review_steps(uuid, jsonb);
-- (the app then falls back to delete + insert with restore-on-failure).

create or replace function public.replace_itp_review_steps(p_itp_id uuid, p_steps jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_status text;
  v_count integer;
begin
  if auth.uid() is null or not public.is_jags_staff() then
    raise exception 'Only JAGS staff can start a review chain' using errcode = '42501';
  end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 then
    raise exception 'A review chain needs at least one reviewer' using errcode = '22023';
  end if;

  select status into v_status from public.itps where id = p_itp_id for update;
  if not found then
    raise exception 'ITP not found' using errcode = 'P0002';
  end if;
  if v_status <> 'under_review' then
    raise exception 'Review steps can only be set while the ITP is under review' using errcode = '22023';
  end if;

  if (select count(distinct (s->>'reviewer_user_id')) from jsonb_array_elements(p_steps) s)
     <> jsonb_array_length(p_steps) then
    raise exception 'Each reviewer can only appear once in the chain' using errcode = '22023';
  end if;

  delete from public.itp_review_progress where itp_id = p_itp_id;

  insert into public.itp_review_progress (itp_id, reviewer_user_id, sort_order, status)
  select p_itp_id, (s->>'reviewer_user_id')::uuid, coalesce((s->>'sort_order')::int, 0), 'pending'
    from jsonb_array_elements(p_steps) s;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.replace_itp_review_steps(uuid, jsonb) from public, anon;
grant execute on function public.replace_itp_review_steps(uuid, jsonb) to authenticated;
