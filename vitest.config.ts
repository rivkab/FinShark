import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./vitest.global-setup.ts"],
    include: ["shared/src/**/*.test.ts", "server/src/**/*.test.ts", "web/src/**/*.test.{ts,tsx}"],
  },
});
