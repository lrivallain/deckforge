import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.js"],
    environment: "node",
    testTimeout: 15000,
    // Never read the developer's ~/.config/deckforge during tests.
    env: { DECKFORGE_CONFIG_DIR: path.join(os.tmpdir(), "deckforge-test-no-config") },
  },
});
