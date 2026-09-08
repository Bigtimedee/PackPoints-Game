import { db } from "../db";
import { dailyChallengeEntries, dailyChallenges, users } from "@shared/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { getPackptsDayKey, PACKPTS_DAY_TZ } from "@shared/packptsDay";
import {
  buildBeatMePath,
  buildBeatMeUrl,
  parseBeatMeCorrectCount,
  sanitizeBeatMeName,
  signBeatMeToken,
} from "../lib/daily5BeatMeToken";

export {
  BEAT_ME_UTM,
  buildBeatMePath,
  buildBeatMeUrl,
  parseBeatMeCorrectCount,
  resolveBeatMeToken,
  sanitizeBeatMeName,
  signBeatMeToken,
  verifyBeatMeToken,
} from "../lib/daily5BeatMeToken";

export async function createBeatMeFromSession(userId: string): Promise<{
  token: string;
  url: string;
  path: string;
  puzzleDay: string;
  timezone: string;
  correctCount: number;
  displayName?: string;
}> {
  const today = getPackptsDayKey();

  const [challenge] = await db
    .select()
    .from(dailyChallenges)
    .where(eq(dailyChallenges.date, today))
    .limit(1);

  if (!challenge) {
    throw new Error("No Daily 5 for today's CT day");
  }

  const [entry] = await db
    .select()
    .from(dailyChallengeEntries)
    .where(
      and(
        eq(dailyChallengeEntries.dailyChallengeId, challenge.id),
        eq(dailyChallengeEntries.userId, userId),
        isNotNull(dailyChallengeEntries.completedAt),
      ),
    )
    .limit(1);

  if (!entry) {
    throw new Error("Finish today's Daily 5 before sharing a challenge");
  }

  const s = parseBeatMeCorrectCount(entry.correctCount);
  if (s === undefined) {
    throw new Error("Session score is not a valid 0–5 count");
  }

  const [user] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const displayName = sanitizeBeatMeName(user?.username);
  const token = signBeatMeToken({
    correctCount: s,
    puzzleDay: today,
    displayName,
    userId,
  });

  return {
    token,
    path: buildBeatMePath(token),
    url: buildBeatMeUrl(token),
    puzzleDay: today,
    timezone: PACKPTS_DAY_TZ,
    correctCount: s,
    displayName,
  };
}
