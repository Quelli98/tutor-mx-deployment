import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The shared 4 GB runners also host other jobs. Starting several PGlite
    // engines together can exhaust their CPU/memory budget and time out schema
    // setup. Run the same isolated files sequentially locally and in CI.
    fileParallelism: false,
    // Cold WebAssembly/PostgreSQL startup needs longer than a unit-test hook.
    // Keep this bounded; an actual setup failure must still fail the suite.
    hookTimeout: 60_000,
    testTimeout: 15_000,
    include: ["src/**/*.test.ts"],
    exclude: ["frontend/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/generated/**",
        "src/server.ts",
      ],
      reporter: ["text", "html", "lcov"],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 83,
        lines: 90,
      },
    },
  },
});
