import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({ command }) => ({
  // UI development needs no CLI authentication. Test inference on a branch preview.
  plugins: [cloudflare({ remoteBindings: command === "serve" ? false : undefined })],
  build: {
    outDir: "dist",
    target: "esnext",
  },
}));
