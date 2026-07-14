import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflare } from "@cloudflare/vite-plugin";
import agents from "agents/vite";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [cloudflare(), agents()],
  resolve: {
    alias: {
      '@client': path.resolve(rootDir, 'src/client'),
      '@server': path.resolve(rootDir, 'src/server'),
      '@shared': path.resolve(rootDir, 'src/shared'),
      '@': path.resolve(rootDir, 'src/client'),
    },
  },
});
