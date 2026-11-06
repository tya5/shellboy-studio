import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["data/test/**/*.test.ts"] },
});
