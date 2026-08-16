import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["frontend/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/generated/**",
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
