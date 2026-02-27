import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    isolate: true,
    sequence: {
      concurrent: false
    }
  }
});
