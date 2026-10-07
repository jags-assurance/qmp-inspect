import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveChecklistResponseAction, completeInspectionCore } from "@/lib/checklists/actions";
import { createNcrAction, addNcrPhotoAction } from "@/lib/ncrs/actions";
import { addMeasurementAction, addPhotoAction, addSignatureAction } from "@/lib/standalone/actions";
import { STANDALONE_ASSIGNMENT_MEASUREMENTS, STANDALONE_ASSIGNMENT_PHOTOS, STANDALONE_ASSIGNMENT_SIGNATURES } from "@/lib/standalone/types";
import { validateOfflinePhoto } from "@/lib/checklists/photo-validation";
import { MAX_PHOTO_BYTES } from "@/lib/checklists/photo-validation";
import { INSPECTION_PHOTOS_TABLE, CHECKLIST_RESPONSES_TABLE, INSPECTION_RECORDS_TABLE } from "@/lib/checklists/db-types";

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
  const authClient = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await authClient.auth.getUser();
  if (!authUser) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const formData = await request.formData();
  const kind = String(formData.get("kind") ?? "");
  // Stable per queued item: lets a replay after a lost response be recognised as the same item.
  const clientKey = (request.headers.get("x-idempotency-key") ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);

  try {
    switch (kind) {
      case "checklist_response": {
        const saved = await saveChecklistResponseAction(formData);
        if (saved && typeof saved === "object" && "conflict" in saved && saved.conflict) {
          // Replay of an item that already landed (response lost): the stored answer equals ours.
          const itemId = String(formData.get("checklist_item_id") ?? "");
          const recId = String(formData.get("inspection_record_id") ?? "");
          const { data: current } = await authClient
            .from(CHECKLIST_RESPONSES_TABLE)
            .select("result, comment")
            .eq("inspection_record_id", recId)
            .eq("checklist_item_id", itemId)
            .maybeSingle<{ result: string; comment: string | null }>();
          if (
            current &&
            current.result === String(formData.get("result") ?? "") &&
            (current.comment ?? "") === String(formData.get("comment") ?? "").trim()
          ) {
            return NextResponse.json({ ok: true });
          }
          return NextResponse.json({ ok: false, conflict: true, error: saved.error ?? "Answer changed on the server." }, { status: 409 });
        }
        if (saved && typeof saved === "object" && "error" in saved && saved.error) {
          return NextResponse.json({ ok: false, error: saved.error }, { status: 422 });
        }
        return NextResponse.json({ ok: true });
      }

      case "complete_inspection": {
        const result = await completeInspectionCore(formData);
        if (result.error) {
          // A replay after a lost response: the inspection already completed with an overall result.
          if (/already (been )?completed/i.test(result.error)) {
            const recId = String(formData.get("inspection_record_id") ?? "");
            const { data: rec } = await authClient
              .from(INSPECTION_RECORDS_TABLE)
              .select("overall_result")
              .eq("id", recId)
              .maybeSingle<{ overall_result: string | null }>();
            if (rec?.overall_result) return NextResponse.json({ ok: true });
          }
          return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
        }
        return NextResponse.json({ ok: true });
      }

      case "raise_observation": {
        // Queued by QuickRaiseObservation: same validated createNcrAction the register's form uses
        // (due date, severity, punch-list item, notification, audit), told to return instead of
        // redirect since there's no page to navigate when replaying from the outbox.
        // Idempotent: createNcrAction owns the storage-marker dedupe keyed by request_id, so the
        // queued item's key is passed through and online/offline paths share one marker.
        if (clientKey && !String(formData.get("request_id") ?? "").trim()) formData.set("request_id", clientKey);
        formData.set("severity", "observation");
        formData.set("stay_on_page", "true");
        const result = await createNcrAction({ error: null }, formData);
        // A punch-list warning still means the NCR exists: treat as success so a retry never duplicates it.
        if (!result.created) {
          // Same key still being processed by another request: transient, keep the item queued.
          if (result.inFlight) return NextResponse.json({ ok: false, error: result.error }, { status: 503 });
          return NextResponse.json({ ok: false, error: result.error ?? "Could not raise the observation." }, { status: 422 });
        }

        // Optional photo taken with the quick form. Best-effort AFTER the NCR exists: failing the
        // whole item here would leave it in the outbox and a retry would raise a duplicate NCR.
        const photo = formData.get("file");
        // Validate type/size like the checklist photo path; an invalid one is skipped (NCR already exists).
        if (photo instanceof Blob && photo.type.startsWith("image/") && photo.size <= MAX_PHOTO_BYTES) {
          const projectId = String(formData.get("project_id") ?? "").trim();
          const safeName = String(formData.get("file_name") ?? "photo.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
          const path = `${projectId}/ncrs/${result.created.id}/${Date.now()}-${safeName}`;
          const supabase = await createSupabaseServerClient();
          const { error: uploadError } = await supabase.storage.from("inspection-evidence").upload(path, photo);
          if (!uploadError) {
            const photoForm = new FormData();
            photoForm.set("ncr_id", result.created.id);
            photoForm.set("storage_path", path);
            await addNcrPhotoAction({ error: null }, photoForm);
          }
        }
        return NextResponse.json({ ok: true });
      }

      case "standalone_measurement": {
        // Replay guard: an identical reading already on the assignment means this item landed before.
        const assignmentId = String(formData.get("assignment_id") ?? "").trim();
        const { data: dup } = await authClient
          .from(STANDALONE_ASSIGNMENT_MEASUREMENTS)
          .select("id")
          .eq("assignment_id", assignmentId)
          .eq("description", String(formData.get("description") ?? "").trim())
          .eq("actual_value", String(formData.get("actual_value") ?? "").trim() || null)
          .eq("nominal_value", String(formData.get("nominal_value") ?? "").trim() || null)
          .limit(1);
        if (dup && dup.length > 0) return NextResponse.json({ ok: true });
        const result = await addMeasurementAction({ error: null }, formData);
        if (result.error) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
        return NextResponse.json({ ok: true });
      }

      case "standalone_signature": {
        const assignmentId = String(formData.get("assignment_id") ?? "").trim();
        const signatureData = String(formData.get("signature_data") ?? "").trim();
        const { data: dup } = await authClient
          .from(STANDALONE_ASSIGNMENT_SIGNATURES)
          .select("id")
          .eq("assignment_id", assignmentId)
          .eq("signature_data", signatureData)
          .limit(1);
        if (dup && dup.length > 0) return NextResponse.json({ ok: true });
        const result = await addSignatureAction({ error: null }, formData);
        if (result.error) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
        return NextResponse.json({ ok: true });
      }

      case "standalone_photo": {
        const assignmentId = String(formData.get("assignment_id") ?? "").trim();
        const file = formData.get("file");
        if (!assignmentId || !(file instanceof Blob)) {
          return NextResponse.json({ ok: false, error: "Missing photo data." }, { status: 422 });
        }
        if (!file.type.startsWith("image/") || file.size > MAX_PHOTO_BYTES) {
          return NextResponse.json({ ok: false, error: "Photo must be an image under 15 MB." }, { status: 422 });
        }
        const safeName = String(formData.get("file_name") ?? "photo.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
        // Deterministic path from the idempotency key: a replay targets the same object and record.
        const path = `standalone/${assignmentId}/${clientKey || Date.now()}-${safeName}`;
        const { data: dup } = await authClient.from(STANDALONE_ASSIGNMENT_PHOTOS).select("id").eq("assignment_id", assignmentId).eq("storage_path", path).limit(1);
        if (dup && dup.length > 0) return NextResponse.json({ ok: true });
        const { error: uploadError } = await authClient.storage.from("inspection-evidence").upload(path, file, { upsert: true });
        if (uploadError) return NextResponse.json({ ok: false, error: "Could not store the photo." }, { status: 500 });
        const photoForm = new FormData();
        photoForm.set("assignment_id", assignmentId);
        photoForm.set("storage_path", path);
        const caption = String(formData.get("caption") ?? "").trim();
        if (caption) photoForm.set("caption", caption);
        const result = await addPhotoAction({ error: null }, photoForm);
        if (result.error) {
          await authClient.storage.from("inspection-evidence").remove([path]).catch(() => undefined);
          return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
        }
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

        const check = await validateOfflinePhoto(supabase, { projectId, inspectionRecordId, checklistItemId, file });
        if (check.error) return NextResponse.json({ ok: false, error: check.error }, { status: 422 });

        const fileName = String(formData.get("file_name") ?? "photo.jpg").replace(/[^a-zA-Z0-9.\-_]/g, "_");
        const prefix = checklistItemId
          ? `${projectId}/${inspectionRecordId}/item-${checklistItemId}`
          : `${projectId}/${inspectionRecordId}`;
        // Deterministic path when we have an idempotency key, so a retry targets the same object.
        const path = `${prefix}/${clientKey || Date.now()}-${fileName}`;

        if (clientKey) {
          const { data: existing } = await supabase
            .from(INSPECTION_PHOTOS_TABLE)
            .select("id")
            .eq("inspection_record_id", inspectionRecordId)
            .eq("storage_path", path)
            .limit(1);
          if (existing && existing.length > 0) return NextResponse.json({ ok: true });
        }

        const { error: uploadError } = await supabase.storage.from("inspection-evidence").upload(path, file, { upsert: Boolean(clientKey) });
        if (uploadError) return NextResponse.json({ ok: false, error: "Could not upload the photo. Try again." }, { status: 422 });

        const { error: insertError } = await supabase.from(INSPECTION_PHOTOS_TABLE).insert({
          inspection_record_id: inspectionRecordId,
          storage_path: path,
          uploaded_by: user?.id ?? null,
          checklist_item_id: checklistItemId,
        });
        if (insertError) return NextResponse.json({ ok: false, error: "Could not save the photo record. Try again." }, { status: 422 });

        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ ok: false, error: "Unknown offline queue item kind." }, { status: 400 });
    }
  } catch (err) {
    console.error("[offline-sync] failed", err);
    return NextResponse.json({ ok: false, error: "Sync failed. Will retry." }, { status: 500 });
  }
}
