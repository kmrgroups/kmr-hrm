import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Runs the attendance / leave services against a real Postgres + PostgREST (see tests/integration/README.md).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)), "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)) } },
  test: { include: ["tests/integration/**/*.itest.ts"], testTimeout: 30000, fileParallelism: false },
});
