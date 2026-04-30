import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: path.resolve("ui"),
  envDir: path.resolve("."),
  base: "/ui/",
  build: {
    outDir: path.resolve("ui", "dist"),
    emptyOutDir: true,
  },
});
