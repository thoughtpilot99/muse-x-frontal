import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      CR_DB_PATH: ":memory:",
      MODEL_API_KEY: "test-muse",
    },
  },
});
