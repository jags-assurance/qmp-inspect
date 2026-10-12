import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A Server Component that calls a function exported from a "use client" file, or a component that
 * calls a client hook without being a client component itself, type-checks fine and passes unit
 * tests but throws at render time ("Attempted to call X() from the server"), taking whole pages
 * down. This scans the source for the two shapes that caused real outages.
 */
const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["app", "components", "lib"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "__tests__" || entry.name === "e2e") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

/** True when the first real statement of the file is the "use client" directive (comments skipped). */
function isClientFile(source: string): boolean {
  const stripped = source.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  return /^["']use client["']/.test(stripped);
}

/** True when the first real statement of the file is the "use server" directive (comments skipped). */
function isServerActionFile(source: string): boolean {
  const stripped = source.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  return /^["']use server["']/.test(stripped);
}

const files = DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const sources = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));
const clientFiles = new Set(files.filter((f) => isClientFile(sources.get(f)!)));

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) if (sources.has(c)) return c;
  return null;
}

describe("server/client boundary", () => {
  it("server files do not import plain functions from 'use client' modules", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (clientFiles.has(f)) continue;
      const src = sources.get(f)!;
      for (const m of src.matchAll(/import\s+(?!type\b)\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
        const target = resolveImport(f, m[2]);
        if (!target || !clientFiles.has(target)) continue;
        for (const raw of m[1].split(",")) {
          const name = raw.trim().replace(/^type\s+.*/, "").split(/\s+as\s+/)[0];
          // Components (PascalCase) and hooks are fine to pass across; lower-case helpers are called directly.
          if (name && /^[a-z]/.test(name) && !/^use[A-Z]/.test(name)) offenders.push(`${path.relative(ROOT, f)} imports ${name} from ${path.relative(ROOT, target)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("files that call a client hook are client files (or are hooks themselves)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (clientFiles.has(f)) continue;
      const src = sources.get(f)!;
      const base = path.basename(f);
      if (/^use[A-Z-]/.test(base) || /(^|\/)(hooks?|use-[a-z-]+)\.(ts|tsx)$/.test(f)) continue;
      // Hooks that only exist in client modules in this codebase.
      if (/\buseTranslate\s*\(|\buseLocale\s*\(|\buseState\s*\(|\buseEffect\s*\(|\buseRouter\s*\(|\buseActionState\s*\(|\busePathname\s*\(/.test(src)) {
        // Allowed: a module that defines the hook (it re-exports for client callers).
        if (/export function use[A-Z]/.test(src)) continue;
        offenders.push(path.relative(ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  // Next.js rejects a "use server" module that exports anything but an async function, but only at
  // runtime, when one of its actions is invoked: "A 'use server' file can only export async functions"
  // (error code E352). Real outage: lib/itps/actions.ts exported a const array, and "Generate draft"
  // on New ITP crashed with "Something went wrong" (digest ...@E352) because that page bundles it.
  it("'use server' files export only async functions (and types)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = sources.get(f)!;
      if (!isServerActionFile(src)) continue;
      for (const m of src.matchAll(/^export\s+(?!type\b|interface\b|async\s+function\b|declare\b)(.*)$/gm)) {
        const rest = m[1];
        if (/^const\s+\w+\s*(?::[^=]+)?=\s*async\b/.test(rest)) continue;
        offenders.push(`${path.relative(ROOT, f)}: export ${rest.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
