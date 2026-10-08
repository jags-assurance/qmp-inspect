-- PDF integrity seal (no certificate needed): after the worker renders a controlled PDF it computes the
-- SHA-256 of the exact bytes it stored and appends it here. The public verification page (/verify/...)
-- then lets anyone check that a file they hold is byte-for-byte one the system produced.
-- This is a tamper-evidence fingerprint, NOT a cryptographic signature (no certificate, no signer identity).
-- A re-render with changed content produces a different file, so hashes are kept as a list (append-only).
-- Data Book PDFs keep using handover_certificates.rendered_book_sha256 (20261101000300). Idempotent.
alter table public.handover_certificates add column if not exists rendered_pdf_sha256s text[] not null default '{}';
alter table public.irns add column if not exists rendered_pdf_sha256s text[] not null default '{}';

create or replace function public.record_rendered_pdf_sha256(p_kind text, p_id uuid, p_sha256 text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'A SHA-256 must be 64 lowercase hex characters.' using errcode = '22023';
  end if;
  if p_kind = 'certificate' then
    update public.handover_certificates
       set rendered_pdf_sha256s = array_append(rendered_pdf_sha256s, p_sha256)
     where id = p_id and not (p_sha256 = any (rendered_pdf_sha256s));
  elsif p_kind = 'irn' then
    update public.irns
       set rendered_pdf_sha256s = array_append(rendered_pdf_sha256s, p_sha256)
     where id = p_id and not (p_sha256 = any (rendered_pdf_sha256s));
  else
    raise exception 'Unknown document kind.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.record_rendered_pdf_sha256(text, uuid, text) from public, anon, authenticated;
grant execute on function public.record_rendered_pdf_sha256(text, uuid, text) to service_role;

-- Same public, minimal-fact lookup as before, now also returning the list of rendered-PDF fingerprints.
create or replace function public.verify_document(p_kind text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 128 or p_token !~ '^[0-9a-f]+$' then
    return jsonb_build_object('valid', false);
  end if;
  if p_kind = 'certificate' then
    select jsonb_build_object(
             'valid', true, 'kind', 'handover_certificate',
             'number', hc.certificate_number,
             'status', case when hc.superseded_at is not null then 'superseded'
                            when hc.acknowledged_at is not null then 'acknowledged' else 'issued' end,
             'issued_date', hc.issued_date,
             'conditional', coalesce(hc.is_conditional, false),
             'package_sha256', hc.package_sha256,
             'data_book_sha256', hc.rendered_book_sha256,
             'pdf_sha256s', to_jsonb(hc.rendered_pdf_sha256s))
      into v
      from public.handover_certificates hc where hc.verification_token = p_token;
  elsif p_kind = 'irn' then
    select jsonb_build_object(
             'valid', true, 'kind', 'irn',
             'number', i.irn_number,
             'status', case when i.voided_at is not null then 'void' else 'live' end,
             'issued_date', i.release_date,
             'voided_at', i.voided_at,
             'pdf_sha256s', to_jsonb(i.rendered_pdf_sha256s))
      into v
      from public.irns i where i.verification_token = p_token;
  end if;
  return coalesce(v, jsonb_build_object('valid', false));
end;
$$;

revoke all on function public.verify_document(text, text) from public;
grant execute on function public.verify_document(text, text) to anon, authenticated, service_role;
