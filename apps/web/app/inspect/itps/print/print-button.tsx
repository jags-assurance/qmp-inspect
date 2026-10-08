"use client";

import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";

/** Triggers the browser's native print dialog — "Save as PDF" there is the real PDF export for
 *  R91's register-level requirement, using the .print-area convention in app/globals.css rather
 *  than a new worker PDF template (the register has no fixed per-ITP layout to template). */
export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()} className="no-print">
      <Tx>Print / Save as PDF</Tx>
    </Button>
  );
}
