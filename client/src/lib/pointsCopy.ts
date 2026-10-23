// Points clarity copy deck (Design, 2026-10-11). Strings are final. No em or en dashes.
// Every cash-back line is gated on rebateLive from GET /api/points/value.
import { PACKPTS_KEEP_SHARE_LABEL, USER_REBATE_SHARE_LABEL } from "@shared/rebateEconomics";

const REBATE_SPLIT = `Your rebate is ${USER_REBATE_SHARE_LABEL} of the commission eBay confirms. PackPTS keeps the other ${PACKPTS_KEEP_SHARE_LABEL}.`;

export interface PointsExpiry {
  earnedDays: number | null;
  purchasedDays: number | null;
  bonusDays: number | null;
}

export interface PointsValue {
  rebateLive: boolean;
  centsPerPoint?: number;
  policyEffectiveFrom?: string | null;
  sources?: string[];
  expiry: PointsExpiry | null;
  payoutMinimum?: { cents: number; display: string };
  holdDays?: number;
  asOf?: string;
}

export function formatUsd(cents: number): string {
  return `$${(Math.floor(cents) / 100).toFixed(2)}`;
}

/** Null whenever rebates are not live or the API gave no rate. */
export function usdFor(value: PointsValue | undefined, points: number): string | null {
  if (!value || !value.rebateLive || typeof value.centsPerPoint !== "number") return null;
  return formatUsd(points * value.centsPerPoint);
}

export const PRIMARY = {
  live: "Name the player. Earn points. Use them for cash back on real cards.",
  soon: "Name the player. Earn points. Use them for cash back on real cards.",
};

export function stripSteps(live: boolean) {
  return [
    { title: "Play", body: "Name the player" },
    { title: "Earn", body: "Points land in your wallet" },
    live ? { title: "Get cash back", body: "Rebate on your next real card" } : { title: "Get cash back", body: "Rebate on your next real card" },
  ];
}

export function valueLine(points: number, usd: string | null): string {
  const n = points.toLocaleString("en-US");
  if (usd) return `Your ${n} points are worth up to ${usd} back on eligible eBay cards.`;
  return `You have ${n} points. Use them for cash back on real cards.`;
}

export const GUEST_KEEP = "Sign up to keep these points.";
export const FOOTNOTE_LIVE = "Value changes over time. Shown at today's rate.";
export function primaryCta(live: boolean) {
  return live ? "See how cash back works" : "See how points work";
}

export function pageSteps(live: boolean, holdDays?: number, payoutMin?: string) {
  const days = typeof holdDays === "number" && holdDays > 0 ? holdDays : 60;
  const min = payoutMin || "$10";
  return [
    { title: "Play and earn", body: "Name the player on each card. Correct answers earn points into your wallet." },
    live
      ? { title: "Apply on a real card", body: "Pick a live eBay listing in Marketplace and apply your points. Buy at the normal price." }
      : { title: "Apply on a real card", body: "Pick a live eBay listing in Marketplace and apply your points. Buy at the normal price." },
    live
      ? { title: "Get your rebate", body: `When eBay confirms the sale, your rebate lands in your wallet. ${REBATE_SPLIT} It's held ${days} days, then you can cash out from ${min}.` }
      : { title: "Get your rebate", body: `When eBay confirms the sale, your rebate lands in your wallet. ${REBATE_SPLIT} It's held ${days} days, then you can cash out from ${min}.` },
  ];
}

function daysPhrase(days: number): string {
  return days === 365 ? "365 days" : `${days} day${days === 1 ? "" : "s"}`;
}

/** Built from the live expiration policy. Matches the copy deck when the policy is 365 / never / 90. */
export function expiryAnswer(expiry: PointsExpiry | null): string {
  const e = expiry ?? { earnedDays: null, purchasedDays: null, bonusDays: null };
  const parts: string[] = [];
  parts.push(
    e.earnedDays == null
      ? "Points you earn by playing don't expire."
      : `Points you earn by playing last ${daysPhrase(e.earnedDays)} from when you earn them.`,
  );
  parts.push(
    e.purchasedDays == null
      ? "Points you buy never expire."
      : `Points you buy last ${daysPhrase(e.purchasedDays)} from when you buy them.`,
  );
  parts.push(e.bonusDays == null ? "Bonus points don't expire." : `Bonus points last ${daysPhrase(e.bonusDays)}.`);
  return parts.join(" ");
}

export function checkoutAnswer(live: boolean): string {
  return live
    ? "No. You buy on eBay exactly like normal. The rebate comes from PackPTS once eBay confirms the purchase."
    : "No. You buy on eBay exactly like normal. The rebate comes from PackPTS once eBay confirms the purchase.";
}

export function addingAnswer(live: boolean, expiry: PointsExpiry | null): string {
  void live;
  void expiry;
  return `Your points count toward a rebate on your next card. The rebate is ${USER_REBATE_SHARE_LABEL} of the commission eBay confirms, up to the limit for that purchase. Daily and weekly caps still apply.`;
}

/** Cash-out FAQ. Live only; both values come from /api/points/value. Null hides the question. */
export function cashOutAnswer(value: PointsValue | undefined): string | null {
  if (!value || !value.rebateLive) return null;
  const min = value.payoutMinimum?.display;
  const days = value.holdDays;
  if (!min || typeof days !== "number" || days <= 0) return null;
  return `Once you have ${min} in rebates that are at least ${days} days old.`;
}

export const WALLET = {
  title: "Your points",
  balance: (points: number) => `${points.toLocaleString("en-US")} points`,
  live: (usd: string) => `Worth up to ${usd} back on eligible eBay cards. Rebates pay ${USER_REBATE_SHARE_LABEL} of the eBay commission, up to this amount, the daily cap and the weekly cap.`,
  soon: "Use your points for cash back on real cards.",
  expiring: (n: number) => `${n.toLocaleString("en-US")} points expire in the next 30 days.`,
  link: "How points work",
  close: "Close",
};

/** Store package line. The "never expire" clause only shows when the live policy says so. */
export function storeLine(usd: string | null, expiry: PointsExpiry | null, loaded: boolean): string {
  const split = `Rebates pay ${USER_REBATE_SHARE_LABEL} of the eBay commission, up to the points you apply, the daily cap and the weekly cap.`;
  if (usd) return `Adds up to ${usd} to your next rebate. ${split}`;
  const never = loaded && (!expiry || expiry.purchasedDays == null);
  return never
    ? `Use points for cash back on real cards. Bought points never expire. ${split}`
    : `Use points for cash back on real cards. ${split}`;
}

/** Hold and payout line. Values come live from /api/points/value. Null until loaded. */
export function holdLine(value: PointsValue | undefined): string | null {
  if (!value || !value.rebateLive || typeof value.holdDays !== "number" || !value.payoutMinimum) return null;
  return `Rebates are held ${value.holdDays} days, then you can cash out from ${value.payoutMinimum.display}. Payouts are reviewed before they're sent.`;
}

/**
 * Listing badge. maxCreditCents is already USER_REBATE_SHARE (70%) of the
 * commission estimate: the quote ceiling calls userRebateCents before the
 * daily, weekly and balance caps. Hidden under 25 cents. Do not multiply again.
 */
export const UP_TO_BACK_MIN_CENTS = 25;
export function upToBackLabel(maxCreditCents: number | null | undefined): string | null {
  if (typeof maxCreditCents !== "number" || !Number.isFinite(maxCreditCents) || maxCreditCents < UP_TO_BACK_MIN_CENTS) return null;
  return `About ${formatUsd(maxCreditCents)} back`;
}

export const SIGNUP_BODY_LIVE = "Save your points and use them for cash back on real cards.";

export const ONBOARDING = { title: "Name the player. Earn points.", start: "Start playing", skip: "Skip" };

/** Tour step 2 body, switched on rebateLive like the rest of the deck. */
export function tourEarnStep(live: boolean): string {
  return live
    ? "Correct answers earn PackPTS (points) into your wallet. Use them for cash back on real cards."
    : "Correct answers earn PackPTS (points) into your wallet. Use them for cash back on real cards.";
}

/** Home hero line. No cashback claim until rebates are live. */
export const HOME_HERO = {
  live: "Earn PackPTS for cashback on eligible real cards from eBay.",
  soon: "Earn PackPTS for cashback on eligible real cards from eBay.",
};

/** Home hero type. No money amounts, no point values. */
export const HOME_HERO_TYPE = {
  subhead: "Classic sports cards with the name hidden. Four choices. Pick the right one.",
  steps: [
    { key: "Name", rest: "the player on the card." },
    { key: "Earn PackPTS", rest: "for every right answer." },
    { key: "Use them", rest: "for cashback on eligible real cards from eBay." },
  ],
  trust: "Free to play. Try a round without an account.",
};

/** Splits the kit H1 into its two sentences so the second can take the accent. */
export function heroHeadline(h1: string): string[] {
  const parts = h1.split(/(?<=\.)\s+/).filter(Boolean);
  return parts.length === 2 ? parts : [h1];
}
