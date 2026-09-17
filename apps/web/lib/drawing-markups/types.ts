// Domain types + table-name handle for the `drawing_markups` table
// (supabase/migrations/20260917040000_add_drawing_markups.sql).
//
// `drawing_markups` isn't in the generated Database type yet, so `.from()` can't resolve it against
// the Tables map. Casting the table name here is the one place that gap leaks in; every query still
// gets its real row shape back via an explicit `.returns<T>()` / typed `.single<T>()` — same
// pattern as apps/web/lib/vault/types.ts and apps/web/lib/ncrs/types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const DRAWING_MARKUPS_TABLE = "drawing_markups" as any;

export const DRAWING_MARKUP_TYPES = ["note", "ncr", "photo"] as const;
export type DrawingMarkupType = (typeof DRAWING_MARKUP_TYPES)[number];

export const DRAWING_MARKUP_TYPE_LABELS: Record<DrawingMarkupType, string> = {
  note: "Note",
  ncr: "NCR",
  photo: "Photo",
};

export interface DrawingMarkupRow {
  id: string;
  project_id: string;
  vault_document_id: string;
  x: number;
  y: number;
  markup_type: DrawingMarkupType;
  linked_entity_id: string | null;
  label: string;
  created_by: string | null;
  created_at: string;
}
