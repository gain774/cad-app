import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
  },
  server: {
    port: 5173,
    host: true,
  },
});
