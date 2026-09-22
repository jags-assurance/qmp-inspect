"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Toggles between the ways to start an ITP. Only a tab-selection string lives here — the
 * manual-form, from-template-form and from-AI-form subtrees are passed in as plain ReactNode
 * children (server components can be passed to a client component as children; that's serialized
 * RSC content, not a function), so this component never receives anything non-serializable from
 * its Server Component parent.
 */
export function ItpCreationTabs({
  manual,
  fromTemplate,
  fromAi,
}: {
  manual: ReactNode;
  /** Omit to hide this tab entirely — e.g. a self-managed client's own login gets manual + AI-draft
   * but not the master-template copy flow, which stays staff-only (see itps/new/page.tsx). */
  fromTemplate?: ReactNode;
  /** Omit to hide this tab entirely — R43: the AI entry point must be hidden cleanly, not just fail
   * after submit, when no AI provider key is configured for this deployment (see itps/new/page.tsx's
   * isAiConfigured() check). */
  fromAi?: ReactNode;
}) {
  const [tab, setTab] = useState<"manual" | "template" | "ai">("manual");

  return (
    <div>
      <div className="flex gap-1 rounded-md border border-border bg-surface p-1 text-sm">
        <button
          type="button"
          onClick={() => setTab("manual")}
          className={cn("flex-1 rounded px-3 py-1.5 font-medium", tab === "manual" ? "bg-burgundy text-white" : "text-ink hover:bg-off-white")}
        >
          Build from scratch
        </button>
        {fromTemplate && (
          <button
            type="button"
            onClick={() => setTab("template")}
            className={cn("flex-1 rounded px-3 py-1.5 font-medium", tab === "template" ? "bg-burgundy text-white" : "text-ink hover:bg-off-white")}
          >
            Start from a master template
          </button>
        )}
        {fromAi && (
          <button
            type="button"
            onClick={() => setTab("ai")}
            className={cn("flex-1 rounded px-3 py-1.5 font-medium", tab === "ai" ? "bg-burgundy text-white" : "text-ink hover:bg-off-white")}
          >
            Generate from vault documents
          </button>
        )}
      </div>

      {tab === "manual" ? manual : tab === "template" ? fromTemplate : fromAi}
    </div>
  );
}
