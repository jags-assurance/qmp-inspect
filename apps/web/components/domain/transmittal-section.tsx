import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedFrom } from "@/lib/supabase/untyped";
import { isMissingDbObject, formatUtcDateTime } from "@/lib/databook/db-errors";
import { Badge } from "@/components/ui/badge";
import { TransmittalForm } from "./transmittal-form";
import { TRANSMITTALS_TABLE, canTransmit, transmittalStatusLabel, type TransmittalEntityType, type TransmittalRow } from "@/lib/transmittals/logic";

const LOG_LIMIT = 25;

/**
 * "Email this document" form plus the transmittal log for one document / Data Book (S7-26). Staff only:
 * the caller decides that; the log itself is also RLS-limited to staff with project access. Renders
 * nothing useful (a short note) for a document that is not issued, and nothing at all when the
 * transmittal table does not exist yet.
 */
export async function TransmittalSection({
  entityType,
  entityId,
  projectId,
  status,
}: {
  entityType: TransmittalEntityType;
  entityId: string;
  projectId: string;
  /** vault_documents.status / data_books.status of the entity. */
  status: string;
}) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await untypedFrom(supabase, TRANSMITTALS_TABLE)
    .select("id, batch_id, entity_type, entity_id, entity_label, recipient_email, subject, message, status, last_error, created_at, sent_at, users:sent_by(full_name)")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(LOG_LIMIT)
    .returns<TransmittalRow[]>();
  if (error && isMissingDbObject(error)) return null;
  const log = data ?? [];

  return (
    <section className="mt-8" aria-label="Email transmittals">
      <h3 className="text-sm font-semibold text-ink">Email transmittal</h3>
      {canTransmit(entityType, status) ? (
        <TransmittalForm entityType={entityType} entityId={entityId} projectId={projectId} />
      ) : (
        <p className="mt-1 text-sm text-muted">
          {entityType === "vault_document" ? "Only an approved document can be emailed." : "Only an issued Data Book can be emailed."}
        </p>
      )}

      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Transmittal log</h4>
      {log.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Nothing has been emailed yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border rounded-md border border-border text-sm">
          {log.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-ink" title={t.recipient_email}>
                {t.recipient_email}
              </span>
              <Badge showIcon tone={t.status === "sent" ? "success" : t.status === "failed" ? "danger" : "warning"}>
                {transmittalStatusLabel(t.status)}
              </Badge>
              <span className="text-xs text-muted">
                {formatUtcDateTime(t.sent_at ?? t.created_at)}
                {t.users?.full_name ? ` · ${t.users.full_name}` : ""}
              </span>
              {t.status === "failed" && t.last_error && <span className="w-full text-xs text-danger">{t.last_error}</span>}
              {t.message && <span className="w-full whitespace-pre-line text-xs text-muted">Message: {t.message}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
