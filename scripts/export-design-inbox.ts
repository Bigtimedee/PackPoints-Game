/**
 * Box-side Design packet. One authenticated read at a time. The server does
 * not receive a path and does not write this directory.
 *
 *   PACKPTS_BASE_URL=https://packpts.com COVER_QA_TOKEN=... \
 *     npx tsx scripts/export-design-inbox.ts --set <id> --out <dir> [--review]
 *
 * The token is an environment variable, never an argument. --review writes
 * REVIEW_READY only when every card has source and masked bytes and the
 * profile is explicit. REVIEW_READY is not a release. Default is source-only.
 * Refuses public, static, dist, and masked-cards directories.
 */
import { createWriteStream, mkdirSync, writeFileSync } from "fs";
import path from "path";

const MAX_BYTES = 15 * 1024 * 1024;

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] || null;
}

function refusedDir(dir: string): boolean {
  const text = dir.replace(/\\/g, "/").toLowerCase();
  return text.includes("/public") || text.includes("/static") || text.includes("/dist") || text.includes("masked-cards");
}

async function readJson(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "X-QA-Token": token } });
  if (!res.ok) throw new Error(`GET ${res.status}`);
  return res.json();
}

async function streamTo(url: string, token: string, file: string): Promise<boolean> {
  const res = await fetch(url, { headers: { "X-QA-Token": token }, signal: AbortSignal.timeout(20000) });
  if (!res.ok || !res.body) return false;
  const length = Number(res.headers.get("content-length") || 0);
  if (length > MAX_BYTES) return false;
  let seen = 0;
  const out = createWriteStream(file);
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    seen += chunk.byteLength;
    if (seen > MAX_BYTES) { out.destroy(); return false; }
    if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
  }
  await new Promise<void>((resolve, reject) => { out.end(() => resolve()); out.on("error", reject); });
  return true;
}

async function main(): Promise<void> {
  const base = process.env.PACKPTS_BASE_URL?.replace(/\/$/, "");
  const token = process.env.COVER_QA_TOKEN;
  const setId = arg("--set");
  const out = arg("--out");
  const review = process.argv.includes("--review");
  if (!base || !token || !setId || !out) {
    console.error("Need PACKPTS_BASE_URL, COVER_QA_TOKEN, --set, and --out");
    process.exit(1);
  }
  if (refusedDir(path.resolve(out))) {
    console.error("Refusing a public, static, dist, or masked-cards directory");
    process.exit(1);
  }
  const profile = await readJson(`${base}/api/qa/baseball-expansion/${setId}/profile`, token) as {
    slug?: string; explicit?: boolean; releaseApproval?: boolean;
  };
  const directory = path.resolve(out, profile.slug || setId);
  mkdirSync(path.join(directory, "source"), { recursive: true });
  mkdirSync(path.join(directory, "masked"), { recursive: true });
  let offset = 0;
  let sourceFiles = 0;
  let maskedFiles = 0;
  let rows = 0;
  for (;;) {
    const page = await readJson(`${base}/api/qa/sets/${setId}/cards?offset=${offset}&limit=50`, token) as {
      cards?: { cardId: string; sourcePath: string; maskedPath: string }[];
    };
    const cards = page.cards || [];
    if (cards.length === 0) break;
    for (const card of cards) {
      rows += 1;
      const sourceOk = await streamTo(`${base}${card.sourcePath}`, token, path.join(directory, "source", `${card.cardId}.jpg`));
      if (sourceOk) sourceFiles += 1;
      const maskedOk = await streamTo(`${base}${card.maskedPath}`, token, path.join(directory, "masked", `${card.cardId}.jpg`));
      if (maskedOk) maskedFiles += 1;
    }
    offset += cards.length;
    if (cards.length < 50) break;
  }
  writeFileSync(path.join(directory, "profile.json"), JSON.stringify({ ...profile, releaseApproval: false }, null, 2) + "\n");
  const reviewReady = review && profile.explicit === true && rows > 0 && sourceFiles === rows && maskedFiles === rows;
  if (reviewReady) {
    writeFileSync(path.join(directory, "REVIEW_READY"), JSON.stringify({
      setId, reviewReady: true, releaseApproval: false, designCleared: false, rows,
    }) + "\n");
  }
  console.log(JSON.stringify({ setId, rows, sourceFiles, maskedFiles, reviewReady, releaseApproval: false }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "export failed");
  process.exit(1);
});
