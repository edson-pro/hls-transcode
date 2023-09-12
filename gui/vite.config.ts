import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import renderer from "vite-plugin-electron-renderer";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte(), renderer()],
  resolve: {
    alias: {
      path: "path-browserify",
    },
  },
});
