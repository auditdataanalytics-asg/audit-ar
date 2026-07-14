import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 20000,
    // Serialize test files — they share one Firestore emulator instance and
    // clear it between tests, so parallel files would clobber each other.
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    // Mirror the tsconfig `@/*` → `./src/*` alias.
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
