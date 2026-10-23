"use client";

import { useEffect, useState } from "react";
import { NoticeCard } from "./notice-stack";
import { Tx } from "./tx";
import { FORM_SAVED_EVENT } from "@/lib/hooks/use-keep-form-values";

/**
 * A short "Saved" confirmation after a form succeeds, so a quiet success (the form just clears)
 * is never mistaken for nothing having happened. Forms that already print their own success
 * message do not trigger it. Mounted once in the app shell, announced politely to screen readers.
 */
export function SavedToast() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSaved = () => {
      setShown(true);
      clearTimeout(timer);
      timer = setTimeout(() => setShown(false), 2800);
    };
    window.addEventListener(FORM_SAVED_EVENT, onSaved);
    return () => {
      window.removeEventListener(FORM_SAVED_EVENT, onSaved);
      clearTimeout(timer);
    };
  }, []);
  if (!shown) return null;
  return (
    <NoticeCard role="status" aria-live="polite" className="border-success/30 text-success">
      <Tx>Saved</Tx>
    </NoticeCard>
  );
}
