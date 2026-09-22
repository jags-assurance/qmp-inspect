"use client";

export function ExportButton({ templateId }: { templateId: string }) {
  return (
    <a
      href={`/api/checklist-library/${templateId}/export`}
      className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white"
    >
      Download .xlsx →
    </a>
  );
}
