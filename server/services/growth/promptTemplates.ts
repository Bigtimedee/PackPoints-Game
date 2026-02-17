export const SYSTEM_PROMPT = `You are a social media content creator for PackPoints (PackPTS), a baseball card trivia gaming platform. 
Users identify players from classic card images to earn PackPTS points, redeemable for credits on Goldin Auctions and eBay.

Key brand details:
- Game modes: Solo, 1v1 Friend, 1v1 Random, Daily 5 Challenge
- Currency: PackPTS (earned through gameplay, purchasable in store)
- Target audience: Baseball card collectors and sports memorabilia enthusiasts
- Tone: Fun, competitive, knowledgeable about baseball history, community-driven
- NEVER make up statistics or claim specific user counts unless provided
- NEVER mention pricing details unless provided
- Keep content family-friendly and positive`;

export const DAILY5_ANNOUNCEMENT_PROMPT = (date: string, cardCount: number) =>
  `Create an engaging social media announcement for today's Daily 5 Challenge (${date}).
Everyone plays the same ${cardCount} cards. Generate excitement about the daily competition.
Include a call-to-action. Keep it under 280 characters for Twitter/X compatibility.
Return JSON: { "title": "short headline", "body": "the post text", "hashtags": ["tag1", "tag2"] }`;

export const DAILY5_RECAP_PROMPT = (date: string, topPlayers: { username: string; score: number; correct: number }[]) =>
  `Create a recap post for today's Daily 5 Challenge results (${date}).
Top performers: ${topPlayers.map((p, i) => `${i + 1}. ${p.username} - ${p.score} pts (${p.correct}/5)`).join(", ")}.
Celebrate the winners and encourage others to play tomorrow. Keep under 280 chars.
Return JSON: { "title": "headline", "body": "post text", "hashtags": ["tag1", "tag2"] }`;

export const DISCORD_POST_PROMPT = (theme: string) =>
  `Create a Discord community post about: ${theme}.
Make it engaging for a baseball card collector community. Can be slightly longer than Twitter.
Return JSON: { "title": "post title", "body": "post body (max 500 chars)", "hashtags": [] }`;

export const REDDIT_POST_PROMPT = (theme: string) =>
  `Create a Reddit post for r/baseballcards or similar subreddit about: ${theme}.
Should feel organic and community-driven, not overly promotional. Include a discussion question.
Return JSON: { "title": "reddit title", "body": "post body (max 800 chars)", "hashtags": [] }`;

export const X_THREAD_PROMPT = (theme: string) =>
  `Create a Twitter/X thread (3-5 tweets) about: ${theme}.
Each tweet should be under 280 chars. Make it informative and engaging for baseball card collectors.
Return JSON: { "title": "thread topic", "body": "Tweet 1\\n---\\nTweet 2\\n---\\nTweet 3", "hashtags": ["tag1"] }`;

export const INSTAGRAM_POST_PROMPT = (theme: string) =>
  `Create an Instagram post caption about: ${theme}.
Make it engaging for baseball card collectors. Use line breaks for readability.
Include a strong call-to-action and relevant hashtags. Keep caption under 1000 chars.
Return JSON: { "title": "short headline", "body": "caption text", "hashtags": ["tag1", "tag2", "tag3"] }`;

export const SHORT_VIDEO_SCRIPT_PROMPT = (theme: string) =>
  `Write a 30-60 second video script for TikTok/Instagram Reels about: ${theme}.
Include hook, body, and call-to-action. Format for someone recording a talking-head video.
Return JSON: { "title": "video title", "body": "HOOK: ...\\nBODY: ...\\nCTA: ...", "hashtags": ["tag1", "tag2"] }`;

export const CONTENT_PLAN_PROMPT = (date: string, recentThemes: string[]) =>
  `Create a daily content plan for PackPTS for ${date}.
Recent themes used (avoid repeats): ${recentThemes.length > 0 ? recentThemes.join(", ") : "none yet"}.
Suggest a daily theme and 4-5 content pieces across platforms (Discord, Reddit, X/Twitter, TikTok/IG).
Return JSON: {
  "theme": "daily theme",
  "items": [
    { "type": "DISCORD_POST"|"REDDIT_POST"|"X_THREAD"|"SHORT_VIDEO_SCRIPT", "platform": "discord"|"reddit"|"x"|"tiktok"|"instagram"|"youtube", "brief": "one-line description", "postingMode": "AUTO"|"MANUAL_QUEUE" }
  ]
}
Auto-post to Discord, X/Twitter, and Instagram. Other platforms (Reddit, TikTok, YouTube) should be MANUAL_QUEUE.`;

export const CONTENT_THEMES = [
  "Top rookie cards from the 1987 Topps set",
  "How to spot valuable baseball cards",
  "Daily 5 Challenge tips and strategies",
  "PackPTS earning strategies for beginners",
  "Most iconic baseball card moments in history",
  "Card collecting community spotlight",
  "Vintage vs modern card debate",
  "Hidden gems in classic baseball card sets",
  "PackPTS leaderboard highlights",
  "Baseball card grading basics",
];
