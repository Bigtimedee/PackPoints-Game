export interface AgentConfig {
  enabled: boolean;
  dryRun: boolean;
  timezone: string;
  minPostsPerDay: number;
  maxPostsPerDay: number;
  dailyQueueBuildHour: number;
  siteUrl: string;
  twitter: {
    apiKey: string;
    apiSecret: string;
    accessToken: string;
    accessTokenSecret: string;
    bearerToken: string;
  };
  tiktok: {
    clientKey: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
  };
  abTest: {
    minImpressions: number;
    minDurationHours: number;
    significanceThreshold: number;
  };
}

export const agentConfig: AgentConfig = {
  enabled: process.env.SOCIAL_MEDIA_AGENT_ENABLED === "true",
  dryRun: process.env.AGENT_DRY_RUN === "true",
  timezone: process.env.AGENT_TIMEZONE ?? "America/New_York",
  minPostsPerDay: parseInt(process.env.AGENT_MIN_POSTS_PER_DAY ?? "2"),
  maxPostsPerDay: parseInt(process.env.AGENT_MAX_POSTS_PER_DAY ?? "4"),
  dailyQueueBuildHour: parseInt(process.env.AGENT_DAILY_QUEUE_BUILD_HOUR ?? "2"),
  siteUrl: process.env.PACKPTS_SITE_URL ?? "https://PackPTS.com",
  twitter: {
    apiKey: process.env.TWITTER_API_KEY ?? "",
    apiSecret: process.env.TWITTER_API_SECRET ?? "",
    accessToken: process.env.TWITTER_ACCESS_TOKEN ?? "",
    accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET ?? "",
    bearerToken: process.env.TWITTER_BEARER_TOKEN ?? "",
  },
  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY ?? "",
    clientSecret: process.env.TIKTOK_CLIENT_SECRET ?? "",
    accessToken: process.env.TIKTOK_ACCESS_TOKEN ?? "",
    refreshToken: process.env.TIKTOK_REFRESH_TOKEN ?? "",
  },
  abTest: {
    minImpressions: parseInt(process.env.AGENT_AB_TEST_MIN_IMPRESSIONS ?? "20"),
    minDurationHours: parseInt(process.env.AGENT_AB_TEST_MIN_DURATION_HOURS ?? "24"),
    significanceThreshold: parseFloat(process.env.AGENT_AB_TEST_SIGNIFICANCE_THRESHOLD ?? "0.15"),
  },
};
