import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  test: {
    environment: "node",
    include: ["data/test/**/*.test.ts", "ui-core/test/**/*.test.ts", "designs/**/*.test.{ts,tsx}", "app/**/*.test.ts"],
  },
});
