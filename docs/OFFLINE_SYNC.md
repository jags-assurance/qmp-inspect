# Offline sync: how queued work reaches the server

## What happens today
- Field actions made offline (checklist answers, photos, NCRs, inspection start/complete) are stored in
  IndexedDB (`lib/offline/db.ts`) and replayed by `syncOutbox()` (`lib/offline/sync-client.ts`) against
  `POST /api/offline-sync`.
- Replay triggers while the app is open: page load, the `online` event, tab becoming visible, a 60 s
  timer, and whenever an item is queued (`components/domain/offline-banner.tsx`).
- Every item carries an idempotency key (`x-idempotency-key`). The server dedupes on it: NCRs via
  `ncrs.request_id` (unique per project), start-inspection via a marker file, uploads via deterministic
  storage paths with `upsert`. A retried or doubly-triggered replay therefore cannot duplicate a record.
  `syncOutbox()` also has an in-flight guard so concurrent triggers share one run.

## Background Sync (added)
- When an item is queued the page registers a Background Sync tag `qmp-sync` (feature-detected;
  Chromium on Android/desktop only).
- When the browser regains connectivity it fires `sync` in the service worker (`public/sw.js`). The
  worker messages every open page (`QMP_SYNC`); the page runs the normal `syncOutbox()`.
- Result: a tab left open in the background syncs the moment signal returns, without the user touching it.

## What is deliberately NOT done: replay inside the service worker with no page open
The replay logic cannot be shared with the worker without forking business rules:
- it enforces queue ownership (an item queued by a different user is not replayed), per-group holds and
  dependants ordering, back-off and permanent-failure classification (`lib/offline/policy.ts`);
- it prepares photos (compression, EXIF/timestamp handling) and chains the server's new `updated_at`
  baseline into later queued answers to the same row;
- `public/sw.js` is a hand-written classic script; importing the TypeScript modules would need a second
  bundle target, and a second copy of the rules would drift from the app one.
A worker-only replay that skips any of this risks wrong-user submission, reordered answers or false
conflicts. The queue is never lost: items stay in IndexedDB until the page syncs them.

## Platform limits
- iOS / Safari (all iOS browsers use WebKit) and Firefox do not support Background Sync. There, sync only
  runs while the app is open (the triggers above).
- Even on Chromium the browser may delay or skip the event (battery saver, site engagement, no open tab).
- Storage can be evicted on iOS if the app is not used for about 7 days and persistent storage was not
  granted; the banner warns when it was not.

## What users should do
Reopen the app (or bring the tab to the foreground) when they have signal and wait for the banner to show
nothing queued. Do not clear site data or sign out while items are queued; use "Export queue" if an item
shows as needing review.
