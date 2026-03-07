import type { SocialContentType } from "../contentGenerator";

export const retentionCampaign = {
  campaignId: "retention-v1",

  contentTypeRotation: [
    "STREAK_MILESTONE",
    "REWARD_ANNOUNCEMENT",
    "CHALLENGE",
    "LEADERBOARD_HIGHLIGHT",
  ] as SocialContentType[],

  hashtags: {
    primary: ["#PackPTS", "#SportsCards", "#Streak"],
    secondary: ["#DailyChallenge", "#CardCollector", "#Rewards"],
  },

  ctaVariants: {
    A: "Keep your streak alive at PackPTS.com.",
    B: "Come back for today's card challenge at PackPTS.com.",
  },
};
