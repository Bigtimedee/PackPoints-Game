import type { SocialContentType } from "../contentGenerator";

export const newUserAcquisitionCampaign = {
  campaignId: "new-user-acquisition-v1",

  contentTypeRotation: [
    "TRIVIA_CARD",
    "NEW_USER_ACQUISITION",
    "CHALLENGE",
    "LEADERBOARD_HIGHLIGHT",
    "MARKET_PRICE_SPOTLIGHT",
    "REWARD_ANNOUNCEMENT",
    "STREAK_MILESTONE",
  ] as SocialContentType[],

  hashtags: {
    primary: ["#PackPTS", "#SportsCards", "#TradingCards"],
    secondary: ["#MLB", "#CardCollector", "#Collectibles", "#BaseballCards", "#CardBreaks"],
  },

  ctaVariants: {
    A: "Sign up free at PackPTS.com and start earning rewards today.",
    B: "Challenge yourself at PackPTS.com — the baseball card trivia game.",
  },
};
