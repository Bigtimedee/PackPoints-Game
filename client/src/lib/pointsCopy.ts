// Points clarity copy deck (Design, 2026-10-11). Strings are final. No em or en dashes.
// Every cash-back line is gated on rebateLive from GET /api/points/value.

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
  soon: "Name the player. Earn points. Points work toward rebates on real cards. Rebates open soon.",
};

export function stripSteps(live: boolean) {
  return [
    { title: "Play", body: "Name the player" },
    { title: "Earn", body: "Points land in your wallet" },
    live ? { title: "Get cash back", body: "Rebate on your next real card" } : { title: "Cash back", body: "Coming soon" },
  ];
}

export function valueLine(points: number, usd: string | null): string {
  const n = points.toLocaleString("en-US");
  if (usd) return `Your ${n} points are worth up to ${usd} back on eligible eBay cards.`;
  return `You have ${n} points. Points work toward rebates on real cards. Rebates open soon.`;
}

export const GUEST_KEEP = "Sign up to keep these points.";
export const FOOTNOTE_LIVE = "Value changes over time. Shown at today's rate.";
export function primaryCta(live: boolean) {
  return live ? "See how cash back works" : "See how points work";
}

export function pageSteps(live: boolean) {
  return [
    { title: "Play and earn", body: "Name the player on each card. Correct answers earn points into your wallet." },
    live
      ? { title: "Apply on a real card", body: "Pick a live eBay listing in Marketplace and apply your points. Buy at the normal price." }
      : { title: "Apply on a real card", body: "Soon you'll apply points on live eBay and Goldin listings." },
    live
      ? { title: "Get your rebate", body: "When eBay confirms the sale, usually within a day or two, your rebate lands in your wallet. It's held 30 days, then you can cash out from $10." }
      : { title: "Get a rebate", body: "Coming soon. We'll tell you the day it opens." },
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
    : "No. When rebates open, you'll still buy on eBay or Goldin like normal.";
}

export function addingAnswer(live: boolean, expiry: PointsExpiry | null): string {
  if (live) return "Your points count toward a rebate on your next card, up to the limit for that purchase.";
  const neverExpire = !expiry || expiry.purchasedDays == null;
  return neverExpire
    ? "Your points will count toward rebates once they open. Points you buy never expire."
    : "Your points will count toward rebates once they open.";
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
  live: (usd: string) => `Worth up to ${usd} back on eligible eBay cards.`,
  soon: "Points work toward rebates on real cards. Rebates open soon.",
  expiring: (n: number) => `${n.toLocaleString("en-US")} points expire in the next 30 days.`,
  link: "How points work",
  close: "Close",
};

/** Store package line. The "never expire" clause only shows when the live policy says so. */
export function storeLine(usd: string | null, expiry: PointsExpiry | null, loaded: boolean): string {
  if (usd) return `Adds up to ${usd} to your next rebate.`;
  const never = loaded && (!expiry || expiry.purchasedDays == null);
  return never
    ? "Points work toward rebates on real cards. Coming soon. Bought points never expire."
    : "Points work toward rebates on real cards. Coming soon.";
}

export const SIGNUP_BODY_LIVE = "Save your points and use them for cash back on real cards.";

export const ONBOARDING = { title: "Name the player. Earn points.", start: "Start playing", skip: "Skip" };

/** Tour step 2 body, switched on rebateLive like the rest of the deck. */
export function tourEarnStep(live: boolean): string {
  return live
    ? "Correct answers earn PackPTS (points) into your wallet. Use them for cash back on real cards."
    : "Correct answers earn PackPTS (points) into your wallet. Points work toward rebates on real cards. Rebates open soon.";
}

/** Home hero line. No cashback claim until rebates are live. */
export const HOME_HERO = {
  live: "Earn PackPTS for cashback on eligible real cards from eBay.",
  soon: "Name the player. Earn points. Points work toward rebates on real cards. Rebates open soon.",
};
