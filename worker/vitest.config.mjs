import path from "node:path";
// The worker has no vitest dependency of its own; reuse apps/web's install (run: pnpm --filter ./apps/web exec vitest run --root ../../worker).
export default {
  test: { environment: "node", include: ["__tests__/**/*.test.ts"] },
  resolve: { alias: { vitest: path.resolve(__dirname, "../apps/web/node_modules/vitest/dist/index.js") } },
};
