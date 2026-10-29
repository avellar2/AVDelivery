import { fileURLToPath } from "node:url";

import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    test: {
      environment: "node",
      include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
      testTimeout: 30_000,
      hookTimeout: 60_000,
      env,
    },
  };
});
