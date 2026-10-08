"use server";

import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildLikePattern } from "./pattern";

export interface EntityHit {
  kind: "project" | "ncr" | "observation" | "itp" | "inspection";
  id: string;
  label: string;
  sub: string;
  href: string;
}

const PER_KIND = 5;

/**
 * Command-palette record search: projects, NCRs, ITPs and inspection records whose number / title /
 * name matches. Every query runs under the CALLER's own RLS session, so a user only ever finds what
 * they could already open — there is no separate permission check to drift out of step. Each table
 * is capped to a handful of rows and a failing table simply contributes nothing.
 */
export async function searchEntitiesAction(rawQuery: string): Promise<EntityHit[]> {
  await requireSession();
  const pattern = buildLikePattern(rawQuery);
  if (!pattern) return [];

  const supabase = await createSupabaseServerClient();
  const [projects, ncrs, itps, inspections] = await Promise.all([
    supabase
      .from("projects")
      .select("id, project_number, name")
      .or(`name.ilike.${pattern},project_number.ilike.${pattern}`)
      .limit(PER_KIND)
      .returns<{ id: string; project_number: string; name: string }[]>(),
    supabase
      .from("ncrs" as never)
      .select("id, ncr_number, description, status, severity")
      .or(`ncr_number.ilike.${pattern},description.ilike.${pattern}`)
      .order("created_at" as never, { ascending: false })
      .limit(PER_KIND)
      .returns<{ id: string; ncr_number: string; description: string; status: string; severity: string | null }[]>(),
    supabase
      .from("itps")
      .select("id, itp_number, title, status")
      .or(`itp_number.ilike.${pattern},title.ilike.${pattern}`)
      .limit(PER_KIND)
      .returns<{ id: string; itp_number: string; title: string; status: string }[]>(),
    supabase
      .from("inspection_records")
      .select("id, record_number, activity")
      .or(`record_number.ilike.${pattern},activity.ilike.${pattern}`)
      .order("created_at", { ascending: false })
      .limit(PER_KIND)
      .returns<{ id: string; record_number: string; activity: string }[]>(),
  ]);

  const hits: EntityHit[] = [];
  for (const p of projects.data ?? []) {
    hits.push({ kind: "project", id: p.id, label: `${p.project_number} — ${p.name}`, sub: "Project", href: `/inspect/projects/${p.id}` });
  }
  for (const n of ncrs.data ?? []) {
    // Observations live in the same table as NCRs (severity "observation") but have their own register.
    const isObservation = n.severity === "observation";
    hits.push({
      kind: isObservation ? "observation" : "ncr",
      id: n.id,
      label: n.ncr_number,
      sub: `${isObservation ? "Observation" : "NCR"} · ${n.status} · ${n.description.slice(0, 60)}`,
      href: `/inspect/ncrs/${n.id}`,
    });
  }
  for (const i of itps.data ?? []) {
    hits.push({ kind: "itp", id: i.id, label: `${i.itp_number} ${i.title}`.trim(), sub: `ITP · ${i.status}`, href: `/inspect/itps/${i.id}` });
  }
  for (const r of inspections.data ?? []) {
    hits.push({ kind: "inspection", id: r.id, label: r.record_number, sub: `Inspection · ${r.activity.slice(0, 60)}`, href: `/inspect/inspections/${r.id}` });
  }
  return hits;
}
