-- K16: vault uploads may now be up to 500 MB (resumable/TUS above one 6 MB chunk). A bucket-level
-- file_size_limit below that would still refuse the object server-side, so raise the
-- `inspection-evidence` bucket's limit to 500 MB when one is set and lower (an unset limit already means
-- "up to the global limit", so it is left alone). A bucket limit is capped by
-- the project's GLOBAL upload limit (Dashboard > Storage > Settings, plan-dependent); that cannot be set
-- from SQL and must also be >= 500 MB: see docs/OPERATIONS_RUNBOOK.md, "Large vault uploads".
-- Never lowers an existing higher limit; no-op where the bucket or column does not exist.
-- Forward-only and idempotent.

do $$
begin
  if to_regclass('storage.buckets') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets
       set file_size_limit = 524288000
     where id = 'inspection-evidence'
       and (file_size_limit is not null and file_size_limit < 524288000);
  end if;
end $$;
