/**
 * Route chunk hints. Vite emits a manifest of dynamic entries; the HTML for a
 * route preloads that entry (and the shared chunks it imports) so the chunk
 * download overlaps the shell instead of starting after the shell executes.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";

export interface ManifestChunk {
  file: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
}

const ROUTE_SRC: Array<{ test: (pathname: string) => boolean; src: string }> = [
  { test: (p) => p === "/", src: "src/pages/home.tsx" },
  { test: (p) => p === "/daily" || p === "/daily5", src: "src/pages/daily5.tsx" },
  { test: (p) => p === "/sets", src: "src/pages/browse-sets.tsx" },
  { test: (p) => p.startsWith("/sets/"), src: "src/pages/set-page.tsx" },
  { test: (p) => p === "/points", src: "src/pages/points.tsx" },
  { test: (p) => p === "/how-to-play", src: "src/pages/how-to-play.tsx" },
  { test: (p) => p === "/about", src: "src/pages/about.tsx" },
  { test: (p) => p === "/auth", src: "src/pages/auth.tsx" },
  { test: (p) => p === "/auth/success", src: "src/pages/auth-success.tsx" },
  { test: (p) => p === "/auth/error" || p === "/auth-error", src: "src/pages/auth-error.tsx" },
  { test: (p) => p === "/auth/link-required", src: "src/pages/link-required.tsx" },
  { test: (p) => p.startsWith("/game/"), src: "src/pages/game.tsx" },
  { test: (p) => p === "/leaderboard", src: "src/pages/leaderboard.tsx" },
  { test: (p) => p === "/marketplace", src: "src/pages/marketplace.tsx" },
  { test: (p) => p === "/store", src: "src/pages/store.tsx" },
  { test: (p) => p === "/store/success", src: "src/pages/store-success.tsx" },
  { test: (p) => p === "/store/cancel", src: "src/pages/store-cancel.tsx" },
];

export function pathnameOf(url: string): string {
  const raw = (url || "/").split("?")[0].split("#")[0] || "/";
  return raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
}

export function routeModuleSrc(url: string): string | null {
  const pathname = pathnameOf(url);
  for (const route of ROUTE_SRC) {
    if (route.test(pathname)) return route.src;
  }
  return null;
}

export function modulePreloadTags(manifest: Record<string, ManifestChunk>, src: string): string[] {
  const entry = Object.values(manifest).find((chunk) => chunk.src === src) ?? manifest[src];
  if (!entry?.file || entry.isEntry) return [];
  // Only the route entry. Chrome follows its static imports from this preload.
  // Listing every shared chunk here competes with the shell and the LCP image.
  const href = entry.file.startsWith("/") ? entry.file : `/${entry.file}`;
  return [`<link rel="modulepreload" crossorigin href="${href}" />`];
}

function manifestCandidates(): string[] {
  // esbuild's CJS server bundle leaves import.meta empty. fileURLToPath(undefined)
  // threw on every HTML response. Only use the URL when it is a real file URL.
  const candidates = [
    path.resolve(process.cwd(), "dist/public/.vite/manifest.json"),
    path.resolve(process.cwd(), "public/.vite/manifest.json"),
  ];
  const metaUrl = import.meta.url;
  if (typeof metaUrl === "string" && metaUrl.startsWith("file:")) {
    const here = path.dirname(fileURLToPath(metaUrl));
    candidates.unshift(
      path.resolve(here, "public/.vite/manifest.json"),
      path.resolve(here, "../public/.vite/manifest.json"),
    );
  }
  return candidates;
}

let manifestCache: { at: number; manifest: Record<string, ManifestChunk> | null } | null = null;

export function loadViteManifest(): Record<string, ManifestChunk> | null {
  if (manifestCache && Date.now() - manifestCache.at < 30_000) return manifestCache.manifest;
  let manifest: Record<string, ManifestChunk> | null = null;
  for (const candidate of manifestCandidates()) {
    try {
      if (!fs.existsSync(candidate)) continue;
      manifest = JSON.parse(fs.readFileSync(candidate, "utf8")) as Record<string, ManifestChunk>;
      break;
    } catch {
      manifest = null;
    }
  }
  manifestCache = { at: Date.now(), manifest };
  return manifest;
}

/** Insert route-chunk modulepreload tags before </head>. No-op without a manifest. */
export function injectRouteModulePreload(html: string, url: string, manifest?: Record<string, ManifestChunk> | null): string {
  const src = routeModuleSrc(url);
  if (!src) return html;
  const tags = modulePreloadTags(manifest === undefined ? loadViteManifest() ?? {} : manifest ?? {}, src);
  if (tags.length === 0) return html;
  return html.replace(/<\/head>/i, `    ${tags.join("\n    ")}\n  </head>`);
}
