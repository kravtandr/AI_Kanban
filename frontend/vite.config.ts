/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // VITE_PROXY_TARGET lets a dockerised dev server reach the backend
      // (e.g. http://host.docker.internal:80 through Caddy).
      "/api": process.env.VITE_PROXY_TARGET ?? "http://localhost:8000",
    },
  },
  test: {
    // Чистая логика тестируется в node, компоненты — в jsdom. Разделение по
    // расширению: .test.ts — модули, .test.tsx — React.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test-setup.ts"],
    environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
  },
});
