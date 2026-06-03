import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["evals/**/*.ts", "tests/**/*.ts"],
    globals: false,
  },
});
