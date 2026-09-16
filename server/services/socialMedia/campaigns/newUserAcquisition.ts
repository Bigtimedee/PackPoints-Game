import type { SocialContentType } from "../contentGenerator";
import { AUTO_CAMPAIGN_ID, AUTO_CONTENT_TYPE } from "../marketingSor";

/** Auto queue no longer runs this campaign. Kept so old A/B rows remain readable. */
export const newUserAcquisitionCampaign = {
  campaignId: "new-user-acquisition-v1",

  contentTypeRotation: [AUTO_CONTENT_TYPE] as SocialContentType[],

  hashtags: {
    primary: ["#PackPTS", "#Daily5"],
    secondary: [] as string[],
  },

  ctaVariants: {
    A: "Today's Daily 5 is live at packpts.com/daily",
    B: "Guess who. Keep the streak. packpts.com/daily",
  },
};

export const daily5RitualCampaign = {
  campaignId: AUTO_CAMPAIGN_ID,
  contentTypeRotation: [AUTO_CONTENT_TYPE] as SocialContentType[],
  hashtags: {
    primary: ["#PackPTS", "#Daily5"],
    secondary: [] as string[],
  },
};
