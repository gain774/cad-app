import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    // Three.js is lazy-loaded as its own chunk; the initial bundle stays small.
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    host: true,
  },
});
