import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["__tests__/**/*.test.ts?(x)"],
    exclude: ["node_modules", ".next"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Integration tests must run sequentially (shared DB state)
    fileParallelism: false,
    setupFiles: ["vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/prisma.ts", "lib/cached-data.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
