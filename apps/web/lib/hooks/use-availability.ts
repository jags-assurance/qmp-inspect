"use client";

import { useEffect, useState } from "react";
import { checkAvailabilityAction, type AvailabilityKind, type AvailabilityScope } from "@/lib/forms/availability";

/**
 * Debounced "already exists" check while someone types. Returns the message to show under the
 * field, or null. Stale answers are dropped (a slow reply for an old value never overwrites the
 * answer for the current one), and any failure just shows nothing: the server still enforces
 * the rule on submit.
 */
export function useAvailability(
  kind: AvailabilityKind,
  value: string,
  scope: AvailabilityScope,
  delayMs = 450
): { message: string | null; checking: boolean } {
  const [result, setResult] = useState<{ key: string; message: string | null } | null>(null);
  const trimmed = value.trim();
  const key = `${kind}|${scope.organizationId ?? ""}|${scope.projectId ?? ""}|${scope.partyType ?? ""}|${trimmed.toLowerCase()}`;
  const ready =
    trimmed.length > 0 &&
    (kind === "project_number" ? !!scope.organizationId : kind === "party_name" ? !!scope.projectId && !!scope.partyType : !!scope.projectId);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const r = await checkAvailabilityAction(kind, trimmed, scope);
        if (!cancelled) setResult({ key, message: r.taken ? r.message : null });
      } catch {
        if (!cancelled) setResult({ key, message: null });
      }
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // scope is a fresh object each render; its parts are already in `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, delayMs]);

  const current = ready && result?.key === key ? result.message : null;
  return { message: current, checking: ready && result?.key !== key };
}
