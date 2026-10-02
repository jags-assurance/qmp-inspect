import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveChecklistResponseAction, completeInspectionCore } from "@/lib/checklists/actions";
import { createNcrAction } from "@/lib/ncrs/actions";
import { INSPECTION_PHOTOS_TABLE } from "@/lib/checklists/db-types";

/**
 * The server side of the offline outbox (lib/offline/db.ts, R60): replays one queued item once
 * connectivity is back. Reuses the exact same validated logic the live UI uses wherever an
 * exported action already exists — saveChecklistResponseAction (called as a normal function; a
 * Route Handler is server-side code, so importing a "use server" action here is a direct call, not
 * a network round-trip) and completeInspectionCore (the redirect-free half of
 * completeInspectionAction, split out for exactly this reason). Photo upload never had a Server
 * Action to reuse — PhotoUpload's live path uploads straight from the browser — so its handful of
 * lines are reproduced here against the same table/bucket.
 *
 * One item per request, POSTed as multipart/form-data (a Blob for "photo" kind needs multipart
 * anyway, so every kind uses the same shape for consistency). Auth is whatever RLS the caller's
 * own session cookie carries — same as every other write path in this app; there is no separate
 * "sync" privilege.
 */
export async function POST(request: Request) {
  const formData = await request.formData();
  const kind = String(formData.get("kind") ?? "");

  try {
    switch (kind) {
      case "checklist_response": {
        await saveChecklistResponseAction(formData);
        return NextResponse.json({ ok: true });
      }

      case "complete_inspection": {
        const result = await completeInspectionCore(formData);
        if (result.error) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
        return NextResponse.json({ ok: true });
      }

      case "raise_observation": {
        // Queued by QuickRaiseObservation: same validated createNcrAction the register's form uses
        // (due date, severity, punch-list item, notification, audit), told to return instead of
        // redirect since there's no page to navigate when replaying from the outbox.
        formData.set("severity", "observation");
        formData.set("stay_on_page", "true");
        const result = await createNcrAction({ error: null }, formData);
        if (result.error) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
        return NextResponse.json({ ok: true });
      }

      case "photo": {
        const projectId = String(formData.get("project_id") ?? "").trim();
        const inspectionRecordId = String(formData.get("inspection_record_id") ?? "").trim();
        // Optional — set by ItemPhotoUpload when the photo was captured for one specific checklist
        // item/finding rather than the whole inspection (see photo-upload-helpers.ts).
        const checklistItemId = String(formData.get("checklist_item_id") ?? "").trim() || null;
        const file = formData.get("file");
        if (!projectId || !inspectionRecordId || !(file instanceof Blob)) {
          return NextResponse.json({ ok: false, error: "Missing photo data." }, { status: 422 });
        }

        const supabase = await createSupabaseServerClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        const fileName = String(formData.get("file_name") ?? "photo.jpg").replace(/[^a-zA-Z0-9.\-_]/g, "_");
        const prefix = checklistItemId
          ? `${projectId}/${inspectionRecordId}/item-${checklistItemId}`
          : `${projectId}/${inspectionRecordId}`;
        const path = `${prefix}/${Date.now()}-${fileName}`;

        const { error: uploadError } = await supabase.storage.from("inspection-evidence").upload(path, file);
        if (uploadError) return NextResponse.json({ ok: false, error: uploadError.message }, { status: 422 });

        const { error: insertError } = await supabase.from(INSPECTION_PHOTOS_TABLE).insert({
          inspection_record_id: inspectionRecordId,
          storage_path: path,
          uploaded_by: user?.id ?? null,
          checklist_item_id: checklistItemId,
        });
        if (insertError) return NextResponse.json({ ok: false, error: insertError.message }, { status: 422 });

        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ ok: false, error: `Unknown offline queue item kind: ${kind}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Sync failed." },
      { status: 500 }
    );
  }
}
