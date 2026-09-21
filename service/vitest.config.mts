import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The alias mirrors tsconfig `paths` ("@/*" -> "./src/*"); vitest does not read tsconfig paths on its own.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
