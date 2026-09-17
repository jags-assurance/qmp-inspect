import { defineConfig } from "vitest/config";
import path from "node:path";

// Minimal config for pure-logic unit tests only (see lib/**/__tests__/*.test.ts). This app has no
// local Postgres/Docker stack (see packages/rls-tests' own header comment) and its server actions
// call createSupabaseServerClient(), which depends on next/headers' cookies() and only runs inside
// a real Next.js request — so these tests target small, extracted pure functions instead of
// exercising the full server actions, and never mock Supabase.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
