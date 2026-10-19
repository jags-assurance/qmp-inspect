"use client";

import { createContext, useContext, type ReactNode } from "react";
import { applyTerms, term, type TermKey, type TermOverrides } from "./terms";

const TermsContext = createContext<TermOverrides>({});

/** Supplies the admin's terminology overrides to client components (set once in the inspect layout). */
export function TermsProvider({ overrides, children }: { overrides: TermOverrides; children: ReactNode }) {
  return <TermsContext.Provider value={overrides}>{children}</TermsContext.Provider>;
}

export function useTermOverrides(): TermOverrides {
  return useContext(TermsContext);
}

/** The label for a term in client components. */
export function useTerm(): (key: TermKey, opts?: { plural?: boolean }) => string {
  const overrides = useTermOverrides();
  return (key, opts) => term(key, overrides, opts);
}

/** Applies the overrides to an English display string. */
export function useApplyTerms(): (text: string) => string {
  const overrides = useTermOverrides();
  return (text) => applyTerms(text, overrides);
}

/** Renders a term label: <Term k="observation" plural /> */
export function Term({ k, plural }: { k: TermKey; plural?: boolean }) {
  const t = useTerm();
  return <>{t(k, { plural })}</>;
}
