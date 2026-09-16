import type { SocialContentType } from "../contentGenerator";
import { AUTO_CONTENT_TYPE } from "../marketingSor";

/** Retention rotation is Daily 5 only — no reward/signup FOMO types. */
export const retentionCampaign = {
  campaignId: "retention-v1",

  contentTypeRotation: [AUTO_CONTENT_TYPE] as SocialContentType[],

  hashtags: {
    primary: ["#PackPTS", "#Daily5"],
    secondary: [] as string[],
  },

  ctaVariants: {
    A: "Keep the Daily 5 streak at packpts.com/daily",
    B: "Come back for today's five at packpts.com/daily",
  },
};
