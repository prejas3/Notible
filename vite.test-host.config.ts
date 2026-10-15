import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: "src/product/test-host",
  // `root` is a subdirectory, and Vite looks for .env beside `root` unless
  // told otherwise. The pinned plugin signing key lives in the repo-root
  // .env; without this the build ships with no trusted key and every market
  // entry renders as "unsigned".
  envDir: resolve("."),
  publicDir: resolve("public"),
  plugins: [react()],
  build: {
    outDir: resolve("dist-test-host"),
    emptyOutDir: true,
    rollupOptions: { input: resolve("src/product/test-host/index.html") },
  },
});
