/**
 * Daily 5 X post, run by the app (GTM audit item 11). The box poster missed
 * 20 of 28 days because the box sleeps and has no cron, so the post now lives
 * here, next to the deal it announces.
 *
 * - Off unless DAILY5_X_POST_ENABLED=true. Credentials are the TWITTER_*
 *   Railway variables; they never live in the repo.
 * - Posts once per CT day from DAILY5_X_POST_AT_CT (default 08:00).
 * - Dedupe: daily5_x_posts has one row per CT date. A poster must win the
 *   insert (or re-claim a failed day) before it touches X, and it first reads
 *   today's @PlayPackPTS timeline so a post made by the box script or by hand
 *   is never doubled.
 * - Images are Design-approved files vendored in server/assets/d5-x and
 *   checked by sha256 before upload. A set without its own approved image
 *   uses the generic B2 post and a caption that does not name the set.
 * - Any failure logs at error level and emails ops (opsAlert).
 * - Refuses to post from any account other than @PlayPackPTS.
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { pool } from "../db";
import { opsAlert } from "./opsAlert";
import { ctNow, isDaily5Post } from "./daily5XWatch";

export const D5_X_ACCOUNT = "PlayPackPTS";
const MAX_ATTEMPTS = 3;
const RECLAIM_AFTER_MIN = 10;
const CHECK_EVERY_MS = 5 * 60 * 1000;

interface D5Asset { file: string; sha256: string; namesSet: boolean }

/** Design-approved post images (sha256 from social-gate/APPROVED.json). */
export const D5_GENERIC_ASSET: D5Asset = {
  file: "d5-post-1080-B2.png",
  sha256: "2937f283cb1bc1910bf188e680941905a6cf6320c51381ca8edfd54547edf104",
  namesSet: false,
};
/** The generic B2 art is 1987 Topps, so it may name the set only on a 1987 Topps day. */
export const D5_GENERIC_ART_SET_ID = "37fd025d-2ae1-4c92-b8ad-133375d0c722";
export const D5_SET_ASSETS: Record<string, D5Asset> = {
  "352b33d1-c110-4e09-b641-8e3c02a94442": {
    file: "d5-post-1080-B2-1989-topps.png",
    sha256: "e604c60af80996cede951d83f1e86d486c4a31333d4d250bf70188f54fa31c39",
    namesSet: true,
  },
};

const BANNED_NAMES = /\b(Jordan|Ryan|Ripken|Kelly|Young|Sheffield)\b/;

export function d5Slug(setName: string): string {
  return setName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function buildD5Post(dayKey: string, setId: string, setName: string): { caption: string; asset: D5Asset; named: boolean } {
  const own = D5_SET_ASSETS[setId];
  const asset = own ?? D5_GENERIC_ASSET;
  const named = own ? own.namesSet : setId === D5_GENERIC_ART_SET_ID;
  const ymd = dayKey.replace(/-/g, "");
  const link = `https://packpts.com/daily?utm_source=x&utm_medium=post&utm_campaign=d5_${ymd}&utm_content=daily5_${d5Slug(setName)}`;
  const lead = named ? `Today's Daily 5 is ${setName}. Same five cards for everyone.` : "Today's Daily 5 is up. Same five cards for everyone.";
  const caption = `Can you name all 5?\n\n${lead} Post your honest X/5, no spoilers.\n\nPlay free: ${link}`;
  if (/[\u2013\u2014]/.test(caption)) throw new Error("copy_rule: dash in caption");
  if (BANNED_NAMES.test(caption)) throw new Error("copy_rule: player name in caption");
  return { caption, asset, named };
}

export function loadApprovedAsset(asset: D5Asset, dir = path.join(process.cwd(), "server", "assets", "d5-x")): Buffer {
  const buf = readFileSync(path.join(dir, asset.file));
  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha !== asset.sha256) throw new Error(`asset_not_approved: ${asset.file}`);
  return buf;
}

export function postWindowMinutes(env = process.env): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((env.DAILY5_X_POST_AT_CT || "08:00").trim());
  if (!m) return 8 * 60;
  return Math.min(23 * 60, Number(m[1]) * 60 + Number(m[2]));
}

export function daily5XPostEnabled(env = process.env): boolean {
  return env.DAILY5_X_POST_ENABLED === "true";
}

/** Wins the day for this poster. Returns false when another poster owns it. */
export async function claimD5Day(dayKey: string, source = "server"): Promise<boolean> {
  const r = await pool.query(
    `INSERT INTO daily5_x_posts (date, status, source, attempts, claimed_at, updated_at)
       VALUES ($1::varchar, 'claimed', $2::varchar, 1, now(), now())
     ON CONFLICT (date) DO UPDATE
       SET status = 'claimed', source = EXCLUDED.source, attempts = daily5_x_posts.attempts + 1,
           claimed_at = now(), updated_at = now(), error = NULL
     WHERE daily5_x_posts.status = 'failed'
       AND daily5_x_posts.attempts < ${MAX_ATTEMPTS}
       AND daily5_x_posts.claimed_at < now() - interval '${RECLAIM_AFTER_MIN} minutes'
     RETURNING date`,
    [dayKey, source],
  );
  return (r.rowCount ?? 0) > 0;
}

async function finishD5Day(dayKey: string, status: string, fields: { setId?: string | null; tweetId?: string | null; error?: string | null }): Promise<void> {
  await pool.query(
    `UPDATE daily5_x_posts SET status = $2::varchar, set_id = COALESCE($3::varchar, set_id),
       tweet_id = COALESCE($4::varchar, tweet_id), error = $5::text, updated_at = now() WHERE date = $1::varchar`,
    [dayKey, status, fields.setId ?? null, fields.tweetId ?? null, fields.error ? fields.error.slice(0, 500) : null],
  );
}

export interface D5XClient {
  username(): Promise<string>;
  todaysTexts(sinceIso: string): Promise<string[]>;
  post(text: string, png: Buffer): Promise<string>;
}

async function defaultClient(): Promise<D5XClient> {
  const { TwitterApi, EUploadMimeType } = await import("twitter-api-v2");
  const { agentConfig } = await import("./socialMedia/config");
  const t = agentConfig.twitter;
  if (!t.apiKey || !t.apiSecret || !t.accessToken || !t.accessTokenSecret) {
    throw new Error("credentials_missing: TWITTER_* variables are not all set on the server");
  }
  const client = new TwitterApi({ appKey: t.apiKey, appSecret: t.apiSecret, accessToken: t.accessToken, accessSecret: t.accessTokenSecret });
  let meId: string | null = null;
  return {
    async username() {
      const me = await client.v2.me();
      meId = me.data.id;
      return me.data.username;
    },
    async todaysTexts(sinceIso) {
      if (!meId) meId = (await client.v2.me()).data.id;
      const tl = await client.v2.userTimeline(meId, { start_time: sinceIso, max_results: 20, exclude: ["replies", "retweets"] });
      return (tl.data?.data ?? []).map((tw) => tw.text);
    },
    async post(text, png) {
      const mediaId = await client.v1.uploadMedia(png, { mimeType: EUploadMimeType.Png });
      const res = await client.v2.tweet({ text, media: { media_ids: [mediaId] } });
      return res.data.id;
    },
  };
}

type DealLookup = (dayKey: string) => Promise<{ setId: string | null; setName: string | null }>;
async function defaultDeal(dayKey: string) {
  const { daily5Service } = await import("./daily5Service");
  const preview = await daily5Service.previewDeal(dayKey);
  return { setId: preview.setId, setName: preview.setName };
}

let clientFactory: () => Promise<D5XClient> = defaultClient;
let dealLookup: DealLookup = defaultDeal;
export function setD5XDepsForTests(deps: { client?: () => Promise<D5XClient>; deal?: DealLookup } | null): void {
  clientFactory = deps?.client ?? defaultClient;
  dealLookup = deps?.deal ?? defaultDeal;
}

export type D5XResult =
  | { status: "disabled" | "too_early" | "not_mine" }
  | { status: "dry_run"; date: string; setId: string; setName: string; caption: string; image: string; named: boolean }
  | { status: "posted"; date: string; tweetId: string }
  | { status: "skipped_existing"; date: string }
  | { status: "failed"; date: string; error: string };

/** One attempt for today. dryRun builds the post without claiming or touching X. */
export async function runDaily5XPost(opts: { now?: Date; dryRun?: boolean; force?: boolean } = {}): Promise<D5XResult> {
  const now = opts.now ?? new Date();
  const ct = ctNow(now);
  if (!opts.dryRun && !opts.force && !daily5XPostEnabled()) return { status: "disabled" };
  if (!opts.dryRun && !opts.force && ct.minutes < postWindowMinutes()) return { status: "too_early" };

  if (opts.dryRun) {
    const deal = await dealLookup(ct.day);
    if (!deal.setId || !deal.setName) return { status: "failed", date: ct.day, error: "no_deal_today" };
    const built = buildD5Post(ct.day, deal.setId, deal.setName);
    loadApprovedAsset(built.asset);
    return { status: "dry_run", date: ct.day, setId: deal.setId, setName: deal.setName, caption: built.caption, image: built.asset.file, named: built.named };
  }

  if (!(await claimD5Day(ct.day))) return { status: "not_mine" };
  let setId: string | null = null;
  try {
    const deal = await dealLookup(ct.day);
    if (!deal.setId || !deal.setName) throw new Error("no_deal_today");
    setId = deal.setId;
    const built = buildD5Post(ct.day, deal.setId, deal.setName);
    const png = loadApprovedAsset(built.asset);
    const client = await clientFactory();
    const username = await client.username();
    if (username !== D5_X_ACCOUNT) throw new Error(`wrong_account: credentials are for @${username}`);
    const existing = await client.todaysTexts(ct.midnightUtc.toISOString());
    if (existing.some((t) => isDaily5Post(t, ct.day))) {
      await finishD5Day(ct.day, "skipped_existing", { setId });
      console.log(`[D5XPost] ${ct.day} already posted on X (box or by hand); skipped`);
      return { status: "skipped_existing", date: ct.day };
    }
    const tweetId = await client.post(built.caption, png);
    await finishD5Day(ct.day, "posted", { setId, tweetId });
    console.log(`[D5XPost] ${ct.day} posted https://x.com/${D5_X_ACCOUNT}/status/${tweetId}`);
    return { status: "posted", date: ct.day, tweetId };
  } catch (err: any) {
    const error = String(err?.message || err).slice(0, 300);
    await finishD5Day(ct.day, "failed", { setId, error }).catch(() => {});
    console.error(`[D5XPost] ${ct.day} post failed: ${error}`);
    await opsAlert("d5_x_post_failed", `Daily 5 X post failed (${ct.day})`,
      `The app could not post today's Daily 5 to @${D5_X_ACCOUNT}: ${error}. It retries up to ${MAX_ATTEMPTS} times, ${RECLAIM_AFTER_MIN} minutes apart. Post by hand if this keeps failing.`);
    return { status: "failed", date: ct.day, error };
  }
}

/** Read-only: which X account the server credentials belong to. Never returns secrets. */
export async function d5XAccountCheck(): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const username = await (await clientFactory()).username();
    return { ok: username === D5_X_ACCOUNT, username };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err).slice(0, 200) };
  }
}

export async function d5XPostStatus(dayKey: string): Promise<Record<string, unknown> | null> {
  const r = await pool.query(`SELECT date, status, source, set_id, tweet_id, attempts, error, claimed_at, updated_at FROM daily5_x_posts WHERE date = $1::varchar`, [dayKey]);
  return r.rows[0] ?? null;
}

export function startDaily5XPoster(): void {
  if (!daily5XPostEnabled()) {
    console.log("[D5XPost] disabled (DAILY5_X_POST_ENABLED is not true)");
    return;
  }
  const tick = () => void runDaily5XPost().catch((err) => console.error(`[D5XPost] tick error: ${String(err?.message || err)}`));
  setTimeout(tick, 30_000).unref();
  setInterval(tick, CHECK_EVERY_MS).unref();
  console.log(`[D5XPost] started (posts from ${process.env.DAILY5_X_POST_AT_CT || "08:00"} CT)`);
}
