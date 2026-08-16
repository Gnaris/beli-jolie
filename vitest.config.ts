import { defineConfig } from "vitest/config";
import path from "path";

/**
 * 3 projects Vitest pour ~5-10× de gain de perf :
 *
 *  - `unit`        : env node, parallel. ~258 tests lib/actions/api/scripts/root.
 *                    Le gros du volume, pur logique sans DOM.
 *  - `dom`         : env jsdom, parallel. ~73 tests components/ui/admin/app.
 *                    Setup jsdom (coûteux) mais peut tourner en parallèle.
 *  - `integration` : env node, SÉQUENTIEL (`fileParallelism: false`). ~15 tests
 *                    partagent la DB dev — la parallélisation créerait des
 *                    collisions de state.
 *
 * Avant : `fileParallelism: false` global + `environment: jsdom` global
 * → 1126 s (19 min) sur suite complète, dont 813 s (72 %) juste pour monter
 * jsdom sur des tests qui n'en ont pas besoin.
 *
 * Après : chaque projet ne paie que ce dont il a besoin, et les 258 tests
 * unitaires + 73 tests DOM parallélisent.
 *
 * Commandes utiles :
 *   npm test                          → toute la suite
 *   npx vitest run --project unit     → seulement les tests logique (rapide)
 *   npx vitest run --project dom      → seulement les tests React
 *   npx vitest run --project integration → tests DB
 */

const sharedResolve = {
  alias: {
    "@": path.resolve(__dirname, "."),
    // Stub le marqueur Next.js `server-only` (bloque l'import côté client mais
    // n'existe pas en dep). Sous Vitest node, on veut juste un module vide.
    "server-only": path.resolve(
      __dirname,
      "node_modules/next/dist/compiled/server-only/empty.js",
    ),
  },
};

export default defineConfig({
  resolve: sharedResolve,
  test: {
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ["vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/prisma.ts", "lib/cached-data.ts"],
    },
    projects: [
      {
        resolve: sharedResolve,
        test: {
          name: "unit",
          globals: true,
          environment: "node",
          setupFiles: ["vitest.setup.ts"],
          include: [
            "__tests__/lib/**/*.test.ts?(x)",
            "__tests__/actions/**/*.test.ts?(x)",
            "__tests__/api/**/*.test.ts?(x)",
            "__tests__/scripts/**/*.test.ts?(x)",
            "__tests__/middleware/**/*.test.ts?(x)",
            "__tests__/marketplace-image-path.test.ts",
            "__tests__/order-totals.test.ts",
            "__tests__/stock-units.test.ts",
            "__tests__/validation-bounds.test.ts",
          ],
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
      {
        resolve: sharedResolve,
        test: {
          name: "dom",
          globals: true,
          environment: "jsdom",
          setupFiles: ["vitest.setup.ts"],
          include: [
            "__tests__/components/**/*.test.ts?(x)",
            "__tests__/ui/**/*.test.ts?(x)",
            "__tests__/admin/**/*.test.ts?(x)",
            "__tests__/app/**/*.test.ts?(x)",
          ],
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
      {
        resolve: sharedResolve,
        test: {
          name: "integration",
          globals: true,
          environment: "node",
          setupFiles: ["vitest.setup.ts"],
          include: ["__tests__/integration/**/*.test.ts?(x)"],
          // DB partagée entre tests → séquentiel obligatoire.
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
    ],
  },
});
