// Referral invite copy and helpers (REFERRAL_SPEC.md). No em or en dashes, no dollar figures.
import { useQuery } from "@tanstack/react-query";

export type InviteSurface = "game_complete" | "wallet" | "share_card" | "faq";

export interface InviteOffer {
  signedIn: boolean;
  inviterBonus: number;
  invitedBonus: number;
  welcomeBonus: number;
  weeklyCap: number;
  holdDays: number;
  code?: string;
  url?: string;
  shareLine?: string;
  pending?: number;
  earned?: number;
}

export const INVITE_SHARE_LINE = "Name the player on the cards you grew up with. Play free with my link:";

export const INVITE = {
  headline: "Invite a friend. You both get points when they finish their first game.",
  walletRow: (pts: number) => `Invite friends: +${pts.toLocaleString("en-US")} pts each`,
  codeLabel: "Your invite code",
  share: "Share invite link",
  copied: "Invite link copied",
  guestCta: "Sign up to get your invite link",
  faqQ: "How do invites work?",
  faqA: (o: InviteOffer) =>
    `Share your invite link. When a friend signs up with it they get ${o.welcomeBonus} points. When they finish their first game, you get ${o.inviterBonus} points and they get ${o.invitedBonus} more. ` +
    `You can earn invite points for up to ${o.weeklyCap} friends a week. Invite points are held for ${o.holdDays} days and are removed if the account is found to be a duplicate or breaks the rules. Inviting yourself does not count.`,
};

/** The user's invite link tagged with where it was shared from. */
export function inviteLink(url: string, surface: InviteSurface): string {
  return `${url}${url.includes("?") ? "&" : "?"}s=${surface}`;
}

export function useInviteOffer(enabled = true) {
  return useQuery<InviteOffer>({ queryKey: ["/api/referrals/offer"], enabled, retry: 1, staleTime: 5 * 60 * 1000 });
}

/** Native share sheet when available, otherwise copy. Returns "shared" | "copied" | "failed". */
export async function shareInvite(url: string): Promise<"shared" | "copied" | "failed"> {
  const text = `${INVITE_SHARE_LINE} ${url}`;
  if (typeof navigator !== "undefined" && navigator.share) {
    try { await navigator.share({ title: "PackPTS", text }); return "shared"; } catch { return "failed"; }
  }
  try { await navigator.clipboard.writeText(text); return "copied"; } catch { return "failed"; }
}
