import { defineConfig } from "vite";

export default defineConfig({
  // client/assets/ (maps, tilesets, sprites) is served at the web root.
  publicDir: "assets",
  // @office/shared is a workspace symlink shipping raw .ts — don't pre-bundle.
  optimizeDeps: { exclude: ["@office/shared"] },
  server: { port: 5173 },
});
