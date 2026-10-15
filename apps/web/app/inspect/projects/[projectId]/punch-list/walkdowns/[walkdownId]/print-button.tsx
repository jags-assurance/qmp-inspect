"use client";
import { Tx } from "@/components/domain/tx";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()} variant="outline">
      <Tx>Print / save as PDF</Tx>
    </Button>
  );
}
