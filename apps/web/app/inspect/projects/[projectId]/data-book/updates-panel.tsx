import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AUDIT_LOG_TABLE } from "@/lib/audit/types";
import { DATA_BOOKS_TABLE } from "@/lib/databook/types";
import { Badge } from "@/components/ui/badge";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";
import { buttonVariants } from "@/components/ui/button";

const PAGE_SIZE = 50;

type Cat = "book" | "itp" | "inspection" | "ncr" | "punch" | "registers" | "vault";
const CATS: { key: "all" | Cat; label: string }[] = [
  { key: "all", label: "All" },
  { key: "book", label: "Data Book" },
  { key: "itp", label: "ITPs" },
  { key: "inspection", label: "Inspections & IRNs" },
  { key: "ncr", label: "NCRs" },
  { key: "punch", label: "Punch" },
  { key: "registers", label: "Registers" },
  { key: "vault", label: "Vault" },
];

const CAT_META: Record<Cat, { icon: string; tone: "gold" | "info" | "success" | "danger" | "warning" | "neutral"; label: string }> = {
  book: { icon: "\u{1F4D8}", tone: "gold", label: "Data Book" },
  itp: { icon: "\u{1F4CB}", tone: "info", label: "ITP" },
  inspection: { icon: "\u{1F50D}", tone: "success", label: "Inspection" },
  ncr: { icon: "⚠️", tone: "danger", label: "NCR" },
  punch: { icon: "✅", tone: "warning", label: "Punch" },
  registers: { icon: "\u{1F5C2}️", tone: "neutral", label: "Register" },
  vault: { icon: "\u{1F4C1}", tone: "neutral", label: "Vault" },
};

const ALL_TYPES = [
  "data_book", "handover_certificate", "itp", "itp_item", "itp_revision", "itp_item_measurement", "itp_item_evidence_document",
  "inspection_record", "irn", "signoff", "inspection_evidence_document", "ncr", "punch_list_item",
  "calibration_register_entry", "welder_qualification_entry", "personnel_certification_entry", "material_register_entry", "vault_document",
];

function categoryOf(entityType: string): Cat | null {
  if (entityType === "data_book" || entityType === "handover_certificate") return "book";
  if (entityType === "itp" || entityType.startsWith("itp_")) return "itp";
  if (["inspection_record", "irn", "signoff", "inspection_evidence_document"].includes(entityType)) return "inspection";
  if (entityType === "ncr") return "ncr";
  if (entityType === "punch_list_item") return "punch";
  if (entityType.endsWith("_register_entry") || entityType === "welder_qualification_entry" || entityType === "personnel_certification_entry") return "registers";
  if (entityType === "vault_document") return "vault";
  return null;
}

function linkFor(projectId: string, entityType: string, entityId: string): string | null {
  const cat = categoryOf(entityType);
  if (entityType === "itp") return `/inspect/itps/${entityId}`;
  if (entityType === "ncr") return `/inspect/ncrs/${entityId}`;
  if (entityType === "inspection_record") return `/inspect/inspections/${entityId}`;
  if (cat === "book") return `/inspect/projects/${projectId}/data-book`;
  if (cat === "punch") return `/inspect/projects/${projectId}/punch-list`;
  if (cat === "registers") return `/inspect/projects/${projectId}/registers`;
  if (cat === "vault") return "/inspect/vault";
  return null;
}

interface Ev {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  summary: string;
  created_at: string;
  actor: { full_name: string } | null;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const y = new Date(now.getTime() - 86400000);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

/** upd / updn are optional: the parent view passes ?upd= and ?updn= through from its searchParams. */
export async function DataBookUpdatesPanel({
  projectId,
  upd,
  updn,
}: {
  projectId: string;
  upd?: string;
  updn?: string;
}) {
  const tl = await getTranslator();
  const cat = (CATS.some((c) => c.key === upd) ? upd : "all") as "all" | Cat;
  const page = Math.max(1, Math.min(20, parseInt(updn ?? "1", 10) || 1));
  const limit = page * PAGE_SIZE;

  const supabase = await createSupabaseServerClient();

  let q = supabase
    .from(AUDIT_LOG_TABLE)
    .select("id, entity_type, entity_id, action, summary, created_at, actor:users(full_name)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  q = q.in("entity_type", cat === "all" ? ALL_TYPES : ALL_TYPES.filter((t) => categoryOf(t) === cat));
  const { data: raw } = await q.returns<Ev[]>();

  const { data: books } = await supabase
    .from(DATA_BOOKS_TABLE)
    .select("id, book_number, status, compiled_at, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<{ id: string; book_number: string; status: string; compiled_at: string | null; created_at: string }[]>();

  const auditBookIds = new Set((raw ?? []).filter((e) => e.entity_type === "data_book").map((e) => e.entity_id));
  const synthetic: Ev[] =
    cat === "all" || cat === "book"
      ? (books ?? [])
          .filter((b) => b.compiled_at && !auditBookIds.has(b.id))
          .map((b) => ({
            id: `db-${b.id}`,
            entity_type: "data_book",
            entity_id: b.id,
            action: b.status,
            summary: `Data Book ${b.book_number} ${b.status === "issued" ? "issued" : "compiled"}`,
            created_at: b.compiled_at as string,
            actor: null,
          }))
      : [];

  const merged = [...(raw ?? []), ...synthetic].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const hasMore = merged.length > limit;
  const events = merged.slice(0, limit);

  // Staleness: relevant (non-book) changes after the latest generated book.
  const latestCompiled = (books ?? []).map((b) => b.compiled_at).filter((x): x is string => !!x).sort().pop() ?? null;
  let sinceCount = 0;
  if (latestCompiled) {
    const { count } = await supabase
      .from(AUDIT_LOG_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .gt("created_at", latestCompiled)
      .in("entity_type", ALL_TYPES.filter((t) => categoryOf(t) !== "book"));
    sinceCount = count ?? 0;
  }

  const href = (c: string, n = 1) => `?${new URLSearchParams({ upd: c, updn: String(n) }).toString()}#updates`;

  const groups: { day: string; items: Ev[] }[] = [];
  for (const e of events) {
    const day = dayLabel(e.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }

  return (
    <section id="updates" className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-ink"><T>Data Book updates</T></h2>

      {!latestCompiled ? (
        <p className="mt-3 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted"><T>No Data Book has been generated yet.</T></p>
      ) : sinceCount > 0 ? (
        <p className="mt-3 rounded-md border border-warning/60 bg-warning/10 px-3 py-2 text-sm text-ink">
          <strong><T>Book is out of date</T></strong> — {sinceCount} <T>change</T>{sinceCount === 1 ? "" : "s"} <T>since it was last generated on</T>{" "}
          {new Date(latestCompiled).toLocaleString("en-GB")}<T>. Regenerate to include them.</T>
        </p>
      ) : (
        <p className="mt-3 rounded-md border border-success/60 bg-success/10 px-3 py-2 text-sm text-ink">
          <T>Book is up to date (last generated</T> {new Date(latestCompiled).toLocaleString("en-GB")}).
        </p>
      )}

      <details className="group mt-3" open={Boolean(upd || updn)}>
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-off-white [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
          <T>Show updates</T>
        </summary>
      <nav className="mt-3 flex flex-wrap gap-2" aria-label={tl("Filter updates")}>
        {CATS.map((c) => (
          <a
            key={c.key}
            href={href(c.key)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              cat === c.key ? "border-burgundy bg-burgundy text-white" : "border-border text-muted hover:text-ink"
            }`}
          >
            {c.label}
          </a>
        ))}
      </nav>

      {events.length === 0 ? (
        <p className="mt-6 text-sm text-muted"><T>No updates recorded</T>{cat === "all" ? "" : " in this category"} <T>yet.</T></p>
      ) : (
        <div className="mt-5 space-y-5">
          {groups.map((g) => (
            <div key={g.day}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{g.day}</h3>
              <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                {g.items.map((e) => {
                  const c = (categoryOf(e.entity_type) ?? "itp") as Cat;
                  const meta = CAT_META[c];
                  const link = linkFor(projectId, e.entity_type, e.entity_id);
                  return (
                    <li key={e.id} className="flex items-start gap-3 px-3 py-2.5">
                      <span aria-hidden className="mt-0.5 text-base">{meta.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                          <span className="text-xs text-muted">{e.action.replace(/_/g, " ")}</span>
                        </div>
                        <p className="mt-1 break-words text-sm text-ink">{e.summary}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {e.actor?.full_name ?? "System"} · {new Date(e.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                          {link && (
                            <>
                              {" · "}
                              <a href={link} className="text-burgundy hover:underline"><T>View record</T></a>
                            </>
                          )}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {hasMore && (
        <div className="mt-4">
          <a href={href(cat, page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <T>Show more</T>
          </a>
        </div>
      )}
      </details>
    </section>
  );
}
