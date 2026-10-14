/**
 * Daily 5 X post watchdog (GTM audit S5/W9). The Daily 5 post is made at
 * about 8 AM CT. From 9:15 AM CT, once per CT day, check that @PlayPackPTS has
 * posted a Daily 5 today; if not, log at error level and email ops so a person
 * can post by hand. Read-only against X. Never posts.
 */
import { opsAlert } from "./opsAlert";

const CHECK_EVERY_MS = 15 * 60 * 1000;
const DEADLINE_MINUTES_CT = 9 * 60 + 15;
let lastCheckedDay: string | null = null;

export function ctNow(d = new Date()): { day: string; minutes: number; midnightUtc: Date } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  const midnightUtc = new Date(d.getTime() - minutes * 60_000 - d.getUTCSeconds() * 1000 - d.getUTCMilliseconds());
  return { day: `${p.year}-${p.month}-${p.day}`, minutes, midnightUtc };
}

export function isDaily5Post(text: string, ymd: string): boolean {
  return /daily 5/i.test(text) || text.includes(`d5_${ymd.replace(/-/g, "")}`);
}

type Fetcher = (sinceIso: string) => Promise<string[]>;
let fetcher: Fetcher | null = null;
export function setDaily5XFetcherForTests(f: Fetcher | null): void { fetcher = f; lastCheckedDay = null; }

async function defaultFetcher(sinceIso: string): Promise<string[]> {
  const { TwitterApi } = await import("twitter-api-v2");
  const { agentConfig } = await import("./socialMedia/config");
  const t = agentConfig.twitter;
  if (!t.apiKey || !t.accessToken) throw new Error("credentials_missing: TWITTER_API_KEY / TWITTER_ACCESS_TOKEN not set on the server");
  const client = new TwitterApi({ appKey: t.apiKey, appSecret: t.apiSecret, accessToken: t.accessToken, accessSecret: t.accessTokenSecret });
  const me = await client.v2.me();
  const tl = await client.v2.userTimeline(me.data.id, { start_time: sinceIso, max_results: 20, exclude: ["replies", "retweets"] });
  return (tl.data?.data ?? []).map((tw) => tw.text);
}

/** Returns "ok" | "missing" | "error" | "skipped". */
export async function checkDaily5Posted(now = new Date()): Promise<string> {
  const ct = ctNow(now);
  if (ct.minutes < DEADLINE_MINUTES_CT || lastCheckedDay === ct.day) return "skipped";
  lastCheckedDay = ct.day;
  try {
    const texts = await (fetcher ?? defaultFetcher)(ct.midnightUtc.toISOString());
    if (texts.some((t) => isDaily5Post(t, ct.day))) {
      console.log(`[D5XWatch] ${ct.day} Daily 5 post found`);
      return "ok";
    }
    await opsAlert("d5_x_missing", `No Daily 5 post on X by 9:15 AM CT (${ct.day})`,
      `@PlayPackPTS has no Daily 5 post today (${ct.day}). Post it by hand or rerun /workspace/packpts-d5-daily/run.sh.`);
    return "missing";
  } catch (err: any) {
    await opsAlert("d5_x_check_failed", `Could not verify the Daily 5 X post (${ct.day})`, String(err?.message || err));
    return "error";
  }
}

export function startDaily5XWatch(): void {
  const timer = setInterval(() => void checkDaily5Posted(), CHECK_EVERY_MS);
  timer.unref();
  console.log("[D5XWatch] started (checks after 9:15 AM CT)");
}
