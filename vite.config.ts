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

/** The full Tailwind sheet is not on the first-paint critical path. */
function deferStylesheetPlugin(): Plugin {
  return {
    name: "packpts-defer-css",
    enforce: "post",
    transformIndexHtml(html) {
      return html.replace(
        /<link rel="stylesheet"( crossorigin)? href="([^"]+\.css)">/g,
        `<link rel="preload" as="style" href="$2" onload="this.onload=null;this.rel='stylesheet'" /><noscript><link rel="stylesheet" href="$2" /></noscript>`,
      );
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
    deferStylesheetPlugin(),
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
    manifest: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
