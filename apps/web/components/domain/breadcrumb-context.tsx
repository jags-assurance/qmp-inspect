"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const Ctx = createContext<{ tail: string | null; setTail: (v: string | null) => void }>({ tail: null, setTail: () => {} });

/** Lets a detail page add its record (e.g. "NCR-0012") to the header trail. Wraps the whole app shell. */
export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [tail, setTail] = useState<string | null>(null);
  return <Ctx.Provider value={{ tail, setTail }}>{children}</Ctx.Provider>;
}

export function useBreadcrumbTail(): string | null {
  return useContext(Ctx).tail;
}

/** Render once in a detail page: shows `label` after the section name in the header while the page is open. */
export function BreadcrumbTail({ label }: { label: string }) {
  const { setTail } = useContext(Ctx);
  useEffect(() => {
    setTail(label);
    return () => setTail(null);
  }, [label, setTail]);
  return null;
}
