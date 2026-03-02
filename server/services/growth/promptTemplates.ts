// ─────────────────────────────────────────────────────────────────────────────
// MISSION: Every piece of content must serve two objectives in order:
//   1. Create brand awareness — PackPTS is THE baseball card trivia game
//   2. Drive acquisition — get new users to claim a limited Founder spot
//
// The Founders program is the primary conversion mechanism. Founder spots are
// LIMITED. Scarcity and exclusivity must be present in every post.
// URL: https://packpts.com
// ─────────────────────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are the social media voice for PackPTS (packpts.com) — a competitive baseball card trivia game where players identify players from real card images to earn PackPTS points, redeemable on Goldin Auctions and eBay.

PRIMARY MISSION: Every post must work toward two goals simultaneously:
1. BRAND AWARENESS — make people feel PackPTS is the game for serious baseball card collectors
2. ACQUISITION — drive people to claim a Founder spot at packpts.com (spots are LIMITED)

THE FOUNDER OPPORTUNITY:
- PackPTS is in early access. A limited number of Founder spots are available.
- Founders get exclusive status, early access, and recognition in the community forever.
- Once Founder spots are gone, they are gone. This is a real, time-sensitive opportunity.
- Every post must create desire and urgency around this without being spammy.

GAME MECHANICS (use to build desire):
- Players identify baseball players from real vintage and modern card images
- Correct IDs earn PackPTS — redeemable for real value on Goldin Auctions and eBay
- Game modes: Solo, 1v1 Friend, 1v1 Random, Daily 5 Challenge
- The better you know your cards, the more you earn

CONTENT PRINCIPLES:
- Lead with the card/player (the hook is always baseball knowledge, not the product)
- Make the reader feel the game before you mention it
- Urgency is real — Founder spots are actually limited, treat it that way
- NEVER fabricate stats, user counts, or specific Founder spot numbers
- NEVER use gambling or prize-guarantee language
- Tone: knowledgeable, competitive, collector-to-collector authenticity
- End every post with a clear path to action: packpts.com

THE CONVERSION SEQUENCE (follow this arc in every post):
  Card/player hook → "imagine playing this in PackPTS" → Founder scarcity → packpts.com`;

// ─────────────────────────────────────────────────────────────────────────────
// FOUNDER CTA VARIANTS — rotate to avoid repetition
// ─────────────────────────────────────────────────────────────────────────────
export const FOUNDER_CTAS = [
  "Founder spots are limited. Claim yours at packpts.com",
  "Early access is open — but Founder spots won't last. packpts.com",
  "Think you know your cards? Prove it. Claim a Founder spot at packpts.com",
  "Real collectors are already playing. Grab your Founder spot: packpts.com",
  "Founder status is permanent. The window isn't. packpts.com",
  "The leaderboard is open. Founder spots are closing. packpts.com",
];

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM PROMPTS
// ─────────────────────────────────────────────────────────────────────────────

export const INSTAGRAM_POST_PROMPT = (theme: string) =>
  `Write an Instagram post about this baseball card theme: ${theme}

STRUCTURE (follow this exactly):
1. HOOK (line 1): A bold, specific statement about the card/player that stops a collector mid-scroll. Make them feel something — nostalgia, respect, competitiveness.
2. BRIDGE (2-3 lines): Connect that feeling to PackPTS. "This is exactly the kind of card you identify in PackPTS" — make the gameplay feel real and desirable.
3. FOUNDER CTA (final line): One of these angles — exclusivity ("not everyone gets Founder status"), scarcity ("spots are filling"), or urgency ("early access, limited window"). End with packpts.com.

RULES:
- Caption under 1000 characters
- Use line breaks between sections
- 10-15 hashtags: mix collector tags (#baseballcards #vintagecards #sportscards) with brand tags (#packpts #foundermember)
- Never sound like an ad. Sound like a collector who built the game.

Return JSON: { "title": "short headline", "body": "full caption with line breaks", "hashtags": ["tag1", "tag2"] }`;

export const X_THREAD_PROMPT = (theme: string) =>
  `Write a Twitter/X thread (3-5 tweets) about this baseball card theme: ${theme}

THREAD STRUCTURE:
Tweet 1 — HOOK: A punchy, specific take on the card/player. Something a serious collector would retweet. Under 280 chars. No CTA yet.
Tweet 2 — DEPTH: One surprising or little-known fact about this card/player that showcases collector knowledge. Under 280 chars.
Tweet 3 — BRIDGE: "This is the exact kind of card you'd see in PackPTS." Describe the gameplay feeling in 1-2 sentences. Under 280 chars.
Tweet 4 — FOUNDER URGENCY: The opportunity. Limited Founder spots. packpts.com. Under 280 chars. Make it feel real, not hype.
Tweet 5 (optional) — ENGAGEMENT: Question that drives replies ("What era of cards do you collect?"). Under 280 chars.

Separate tweets with ---

Return JSON: { "title": "thread topic", "body": "Tweet 1\\n---\\nTweet 2\\n---\\nTweet 3\\n---\\nTweet 4", "hashtags": ["#packpts", "#baseballcards"] }`;

export const REDDIT_POST_PROMPT = (theme: string) =>
  `Write a Reddit post about this baseball card theme: ${theme}

REDDIT RULES — this must feel 100% organic:
- Write as a passionate collector sharing knowledge, NOT as a brand
- The post should be genuinely useful/interesting on its own merit
- The PackPTS mention should feel like a natural aside, not a promotion
- Include a real discussion question that invites community debate
- Mention PackPTS once, naturally: something like "I actually built a game around identifying cards like this — packpts.com if you want to check it out"

STRUCTURE:
- Title: Specific, curiosity-driven, not clickbait (e.g., "Why the 1987 Topps Bonds rookie is still undervalued")
- Body: 3-4 paragraphs of genuine collector content, natural PackPTS mention in paragraph 3, end with a discussion question

Return JSON: { "title": "reddit title", "body": "full post body", "hashtags": [] }`;

export const DISCORD_POST_PROMPT = (theme: string) =>
  `Write a Discord community post about this baseball card theme: ${theme}

This is for a community of baseball card collectors and trivia players. Tone: casual, competitive, community-insider.

STRUCTURE:
- Opening: A hot take or interesting observation about the card/player that gets conversation going
- Middle: Connect to the PackPTS Daily 5 Challenge or game mechanics — make members feel the competitive energy
- CTA: Remind community members that Founder spots are still available to share with friends who haven't joined yet — "if you know a collector who hasn't claimed their Founder spot, packpts.com"

Keep it under 500 characters. Conversational, not formal.

Return JSON: { "title": "post title", "body": "post body", "hashtags": [] }`;

export const SHORT_VIDEO_SCRIPT_PROMPT = (theme: string) =>
  `Write a 30-60 second TikTok/Reels video script about this baseball card theme: ${theme}

SCRIPT STRUCTURE:
HOOK (0-3 sec): A question or statement that stops the scroll. Must be about the card/player specifically.
BODY (4-40 sec): Show knowledge. Describe what makes this card special — the player, the year, what it was worth, why collectors care. Make the viewer feel smart for watching.
BRIDGE (41-50 sec): "This is exactly the kind of card you identify in PackPTS." One sentence. Make the gameplay sound addictive.
CTA (51-60 sec): Founder angle. Scarcity. packpts.com. "Link in bio."

Format clearly with section labels.

Return JSON: { "title": "video title", "body": "HOOK: ...\\nBODY: ...\\nBRIDGE: ...\\nCTA: ...", "hashtags": ["#packpts", "#baseballcards", "#foundermember"] }`;

// ─────────────────────────────────────────────────────────────────────────────
// DAILY 5 PROMPTS
// ─────────────────────────────────────────────────────────────────────────────

export const DAILY5_ANNOUNCEMENT_PROMPT = (date: string, cardCount: number) =>
  `Write a Daily 5 Challenge announcement for ${date}. Today's challenge has ${cardCount} cards.

OBJECTIVE: Create urgency to play TODAY, AND plant the Founder seed for anyone seeing this who hasn't signed up.

STRUCTURE:
- Line 1: The challenge hook — something competitive ("Today's 5 cards will separate the real collectors from the casuals")
- Line 2-3: Build the tension. Everyone plays the same cards. Leaderboard is live. Can you get perfect?
- Line 4: Founder angle for non-players seeing this: "Haven't claimed your Founder spot yet? Today's the day. packpts.com"

Keep under 280 characters total. High energy.

Return JSON: { "title": "announcement headline", "body": "the post", "hashtags": ["#packpts", "#daily5challenge", "#baseballcards", "#foundermember"] }`;

export const DAILY5_RECAP_PROMPT = (date: string, topPlayers: { username: string; score: number; correct: number }[]) => {
  const leaderboard = topPlayers.map((p, i) => `${i + 1}. ${p.username} — ${p.score} pts (${p.correct}/5)`).join(", ");
  return `Write a Daily 5 Challenge recap for ${date}.
Today's leaderboard: ${leaderboard}

OBJECTIVE: Celebrate winners, create FOMO for non-players, convert that FOMO into Founder sign-ups.

STRUCTURE:
- Line 1: Celebrate the top performer by name and score specifically
- Line 2: Make non-players feel the FOMO ("While you were doing other things, these collectors were stacking points")
- Line 3: Tomorrow's challenge is coming. Founder spots are still available. packpts.com
- End with a challenge: "Think you can crack the top 3 tomorrow?"

Keep under 280 characters. Make the winners feel legendary, make non-players feel like they're missing out.

Return JSON: { "title": "recap headline", "body": "the post", "hashtags": ["#packpts", "#daily5challenge", "#baseballcards", "#leaderboard"] }`;
};

// ─────────────────────────────────────────────────────────────────────────────
// TIKTOK PROMPTS
// ─────────────────────────────────────────────────────────────────────────────

export const TIKTOK_DAILY5_ANNOUNCEMENT_PROMPT = (date: string, cardCount: number) =>
  `Create a TikTok video package announcing today's Daily 5 Challenge (${date}). ${cardCount} cards. Everyone plays the same ones.

The video must accomplish two things: drive today's players to compete AND create Founder FOMO for anyone who hasn't signed up.

Return STRICT JSON:
{
  "hook": "Scroll-stopping opening line. Challenge the viewer's card knowledge directly.",
  "script": "15-30 second script. Open with the challenge hook. Reveal that everyone plays the same cards today. Build competition urgency. End with Founder CTA: 'Founder spots are limited — claim yours at packpts.com, link in bio.'",
  "on_screen_text": ["Daily 5 is LIVE", "Same 5 cards. Everyone.", "Claim your Founder spot"],
  "caption": "TikTok caption under 200 chars. Urgency + Founder CTA + packpts.com",
  "hashtags": ["#packpts", "#baseballcards", "#daily5challenge", "#foundermember", "#sportscards", "#baseballtrivia", "#cardcollector", "#mlb", "#sportstrivia", "#baseballhistory"],
  "cta": "Founder spots are limited. Claim yours at packpts.com — link in bio.",
  "thumbnail_text": "Daily 5 is LIVE",
  "format_notes": "Quick cuts. Countdown energy. Show the Founder angle at the end. 9:16 vertical.",
  "audio_notes": "Urgent, competitive background music. Suspense on card reveal.",
  "asset_refs": [],
  "legal_safe": { "no_gambling_language": true, "no_prize_guarantees": true },
  "dedupe_key": "${date}:TIKTOK_DAILY5_ANNOUNCEMENT"
}

IMPORTANT: Return ONLY valid JSON, no markdown or explanation.`;

export const TIKTOK_TRIVIA_CHALLENGE_PROMPT = (date: string, theme: string) =>
  `Create a TikTok trivia challenge video about: ${theme}
Date: ${date}

This video must: (1) be genuinely fun and test card knowledge, AND (2) make viewers want to play PackPTS and claim a Founder spot.

Return STRICT JSON:
{
  "hook": "One question that stops scrollers cold — specific to the card/player being featured.",
  "script": "20-35 second script. Show the card. Challenge the viewer to name it. Give 2 clues. Dramatic reveal. Then: 'This is exactly the kind of card you identify in PackPTS. Founder spots are still open — packpts.com, link in bio.'",
  "on_screen_text": ["Can you name this player?", "Clue: [relevant clue about the featured card]", "Play this in PackPTS"],
  "caption": "Comment your guess! Then claim your Founder spot at packpts.com — link in bio.",
  "hashtags": ["#packpts", "#baseballcards", "#sportstrivia", "#foundermember", "#baseballquiz", "#sportscards", "#cardcollector", "#mlb", "#baseballtrivia", "#guessthatplayer"],
  "cta": "Think you can get it right every time? Claim your Founder spot at packpts.com — link in bio.",
  "thumbnail_text": "Can You Name This Card?",
  "format_notes": "Card reveal format: show blurred card → clues → reveal → PackPTS CTA. 9:16 vertical.",
  "audio_notes": "Quiz show tension. Dramatic reveal sting. Upbeat on CTA.",
  "asset_refs": [],
  "legal_safe": { "no_gambling_language": true, "no_prize_guarantees": true },
  "dedupe_key": "${date}:TIKTOK_TRIVIA_CHALLENGE"
}

IMPORTANT: Return ONLY valid JSON, no markdown or explanation.`;

export const TIKTOK_LEADERBOARD_SPOTLIGHT_PROMPT = (date: string, topPlayers: { username: string; score: number; correct: number }[]) =>
  `Create a TikTok leaderboard spotlight for ${date}.
Top performers: ${topPlayers.map((p, i) => `${i + 1}. ${p.username} — ${p.score} pts (${p.correct}/5 correct)`).join(", ")}

This video must: (1) make winners feel legendary, AND (2) create Founder FOMO that converts viewers.

Return STRICT JSON:
{
  "hook": "Opening line that names today's top performer and their score — make it sound impressive.",
  "script": "15-25 second script. Count down the top 3. Celebrate their knowledge. Then flip: 'These are Founders. They claimed their spot early. Yours might still be available — packpts.com, link in bio.'",
  "on_screen_text": ["🏆 Today's Champions", "#1 [username] — [score] pts", "Founder spots still open"],
  "caption": "Today's Daily 5 champions. Are you next? Claim your Founder spot: packpts.com",
  "hashtags": ["#packpts", "#baseballcards", "#daily5challenge", "#foundermember", "#leaderboard", "#sportscards", "#cardcollector", "#baseballtrivia", "#champion", "#mlb"],
  "cta": "Think you can make the leaderboard? Claim your Founder spot at packpts.com — link in bio.",
  "thumbnail_text": "Today's Champions 🏆",
  "format_notes": "Countdown reveal of top 3. Celebration effects. Hard cut to Founder CTA. 9:16 vertical.",
  "audio_notes": "Victory fanfare. Celebration sounds. Urgency shift on CTA.",
  "asset_refs": [],
  "legal_safe": { "no_gambling_language": true, "no_prize_guarantees": true },
  "dedupe_key": "${date}:TIKTOK_LEADERBOARD_SPOTLIGHT"
}

IMPORTANT: Return ONLY valid JSON, no markdown or explanation.`;

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT PLAN PROMPT
// ─────────────────────────────────────────────────────────────────────────────

export const CONTENT_PLAN_PROMPT = (date: string, recentThemes: string[]) =>
  `Create a daily content plan for PackPTS for ${date}.

MISSION: Every content piece must build brand awareness AND drive Founder sign-ups at packpts.com.
Recent themes used (avoid repeats): ${recentThemes.length > 0 ? recentThemes.join(", ") : "none yet"}.

Choose a theme that:
- Centers on a specific baseball card, player, or era (the hook is always the card first)
- Creates a natural bridge to PackPTS gameplay
- Makes non-players feel like they're missing something real

Generate 4-5 content pieces across platforms (Discord, Reddit, X/Twitter, Instagram).
Each piece must ladder up to the Founder acquisition objective.

Return JSON: {
  "theme": "daily theme — specific card/player/era focused",
  "items": [
    { "type": "DISCORD_POST"|"REDDIT_POST"|"X_THREAD"|"INSTAGRAM_POST"|"SHORT_VIDEO_SCRIPT", "platform": "discord"|"reddit"|"x"|"instagram"|"youtube", "brief": "one-line description including Founder angle", "postingMode": "AUTO" }
  ]
}`;

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT THEMES — acquisition-focused, card-first
// ─────────────────────────────────────────────────────────────────────────────
export const CONTENT_THEMES = [
  "The 1987 Topps set: why collectors still hunt these 35 years later",
  "Rookie cards that made careers — and what it means to own one",
  "The Daily 5 Challenge: can you go perfect on today's cards?",
  "Why vintage card knowledge is a skill — and how PackPTS sharpens it",
  "The most undervalued cards in every collector's box right now",
  "What separates a real collector from a casual fan",
  "The cards that defined the 1990s — do you know them all?",
  "Founder status is permanent. The window to claim it isn't.",
  "The era wars: 80s vs 90s vs 00s — which era built the best cards?",
  "Hidden value: the cards everyone overlooks in classic sets",
  "The PackPTS leaderboard is live — here's what it takes to top it",
  "Why card identification is harder than people think — and more rewarding",
];
