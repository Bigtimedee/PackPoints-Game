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

export const TIKTOK_DAILY5_ANNOUNCEMENT_PROMPT = (date: string, cardCount: number) =>
  `Create a TikTok video package for announcing today's Daily 5 Challenge (${date}).
Everyone plays the same ${cardCount} baseball cards. The video should generate excitement and urgency.

Return STRICT JSON matching this schema:
{
  "hook": "One attention-grabbing opening line (e.g., 'Can you name all 5 cards before time runs out?')",
  "script": "Full voiceover script for a 15-30 second TikTok video. Include timing cues like [PAUSE], [SHOW CARD], etc.",
  "on_screen_text": ["Text overlay 1", "Text overlay 2", "Text overlay 3"],
  "caption": "TikTok caption under 200 chars with CTA to play",
  "hashtags": ["#packpts", "#baseballcards", "#daily5challenge", "#sportscards", "#baseballtrivia", "#cardcollector", "#mlb", "#vintagebaseball", "#sportstrivia", "#baseballhistory"],
  "cta": "Link in bio to play the Daily 5 Challenge!",
  "thumbnail_text": "Daily 5 Challenge",
  "format_notes": "Quick cuts between card reveals. Countdown timer overlay. 9:16 vertical format.",
  "audio_notes": "Upbeat background music, suspenseful sound for card reveals",
  "asset_refs": [],
  "legal_safe": { "no_gambling_language": true, "no_prize_guarantees": true },
  "dedupe_key": "${date}:TIKTOK_DAILY5_ANNOUNCEMENT"
}

IMPORTANT: Return ONLY valid JSON, no markdown or explanation.`;

export const TIKTOK_TRIVIA_CHALLENGE_PROMPT = (date: string, theme: string) =>
  `Create a TikTok video package for a baseball card trivia challenge about: ${theme}
Date: ${date}

Return STRICT JSON matching this schema:
{
  "hook": "One attention-grabbing question or statement that stops scrollers",
  "script": "Full voiceover script for a 20-35 second TikTok video. Format: reveal a baseball card, challenge viewer to name the player, give clues, reveal answer.",
  "on_screen_text": ["Clue overlay 1", "Clue overlay 2", "Answer reveal text"],
  "caption": "Engaging caption under 200 chars asking viewers to comment their guess",
  "hashtags": ["#packpts", "#baseballcards", "#sportstrivia", "#baseballquiz", "#sportscards", "#cardcollector", "#mlb", "#baseballtrivia", "#vintagebaseball", "#guessthatplayer"],
  "cta": "Comment your guess! Play more at PackPTS - link in bio",
  "thumbnail_text": "Can You Name This Player?",
  "format_notes": "Card reveal format: show blurred/masked card → give clues → dramatic reveal. 9:16 vertical.",
  "audio_notes": "Quiz show style sound effects, dramatic reveal sting",
  "asset_refs": [],
  "legal_safe": { "no_gambling_language": true, "no_prize_guarantees": true },
  "dedupe_key": "${date}:TIKTOK_TRIVIA_CHALLENGE"
}

IMPORTANT: Return ONLY valid JSON, no markdown or explanation.`;

export const TIKTOK_LEADERBOARD_SPOTLIGHT_PROMPT = (date: string, topPlayers: { username: string; score: number; correct: number }[]) =>
  `Create a TikTok video package spotlighting today's Daily 5 Challenge leaderboard results.
Date: ${date}
Top performers: ${topPlayers.map((p, i) => `${i + 1}. ${p.username} - ${p.score} pts (${p.correct}/5 correct)`).join(", ")}

Return STRICT JSON matching this schema:
{
  "hook": "Opening line celebrating today's top performers",
  "script": "Full voiceover script for a 15-25 second TikTok video. Announce top players, celebrate their scores, challenge viewers to beat them tomorrow.",
  "on_screen_text": ["#1 Player Name - Score", "#2 Player Name - Score", "#3 Player Name - Score"],
  "caption": "Congratulations to today's Daily 5 champions! Can you make the leaderboard tomorrow?",
  "hashtags": ["#packpts", "#baseballcards", "#daily5challenge", "#leaderboard", "#sportscards", "#cardcollector", "#baseballtrivia", "#champion", "#sportstrivia", "#mlb"],
  "cta": "Think you can beat them? Play the Daily 5 Challenge - link in bio!",
  "thumbnail_text": "Today's Champions",
  "format_notes": "Countdown reveal of top 3. Confetti/celebration effects. 9:16 vertical.",
  "audio_notes": "Victory fanfare, celebration sounds",
  "asset_refs": [],
  "legal_safe": { "no_gambling_language": true, "no_prize_guarantees": true },
  "dedupe_key": "${date}:TIKTOK_LEADERBOARD_SPOTLIGHT"
}

IMPORTANT: Return ONLY valid JSON, no markdown or explanation.`;

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
