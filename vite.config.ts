import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { upsertBuildIdMeta } from "./shared/buildVersion";
import { resolveBuildId } from "./server/lib/resolveBuildId";

const packptsBuildId = resolveBuildId();

function packptsBuildIdPlugin(buildId: string): Plugin {
  return {
    name: "packpts-build-id",
    transformIndexHtml(html) {
      return upsertBuildIdMeta(html, buildId);
    },
  };
}

export default defineConfig({
  define: {
    __PACKPTS_BUILD_ID__: JSON.stringify(packptsBuildId),
  },
  plugins: [
    react(),
    packptsBuildIdPlugin(packptsBuildId),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
