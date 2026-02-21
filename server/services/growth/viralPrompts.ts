import type { SelectedCard } from "./cardSelector";

export const VIRAL_SYSTEM_PROMPT = `You are a viral TikTok content creator for PackPTS, a baseball card trivia gaming platform.
Users identify players from masked card images to earn PackPTS points.

Key rules:
- NEVER reveal the player name in the hook or before the designated reveal moment
- NEVER use gambling language (bet, jackpot, cash out, guaranteed prizes)
- NEVER make up statistics or user counts
- ALWAYS include a CTA to PackPTS.com
- Keep captions under 200 characters
- Keep content family-friendly, fun, and competitive
- Return ONLY valid JSON, no markdown or explanation`;

function cardContext(cards: SelectedCard[]): string {
  return cards.map((c, i) => `Card ${i + 1}: "${c.player}" from ${c.set} (${c.year}), difficulty: ${c.difficulty}, era: ${c.era}`).join("\n");
}

export function ONLY_REAL_FANS_PROMPT(date: string, cards: SelectedCard[]): string {
  const card = cards[0];
  return `Create a TikTok "Only Real Fans" video package for ${date}.
Format: Show a masked baseball card and challenge viewers to name the player.
The card is: "${card.player}" from ${card.set} (${card.year}).
Difficulty: ${card.difficulty}

The video is 12 seconds:
- 0-2s: Hook text "ONLY REAL FANS GET THIS" with blurred card
- 2-6s: Countdown 3...2...1 with "WHO IS IT?" prompt
- 6-10s: Reveal overlay text showing the answer (keep card image masked)
- 10-12s: CTA to PackPTS.com

Return STRICT JSON:
{
  "hook": "ONLY REAL FANS GET THIS",
  "script": "Full voiceover script with timing cues",
  "on_screen_text": ["ONLY REAL FANS GET THIS", "WHO IS IT?", "3", "2", "1", "Answer: ${card.player}", "Play PackPTS.com"],
  "caption": "Under 200 char caption challenging viewers",
  "hashtags": ["#packpts", "#baseballcards", "#onlyrealfans", "#sportscards", "#baseballtrivia", "#cardcollector", "#mlb", "#guessthatplayer"],
  "cta": "Play the Daily 5 Challenge at PackPTS.com - link in bio!",
  "thumbnail_text": "Only Real Fans",
  "format_notes": "12s vertical video. Masked card throughout. Text reveal at 6s.",
  "audio_notes": "Suspenseful buildup, dramatic reveal sting",
  "asset_refs": [{"type": "card_image", "card_id": "${card.id}", "url": "${card.imageUrl}"}],
  "legal_safe": { "no_gambling_language": true, "no_prize_guarantees": true },
  "dedupe_key": "${date}:only_real_fans:${card.id}",
  "format_id": "only_real_fans",
  "render_template_id": "only_real_fans",
  "scenes": [
    {"sceneId": "hook", "startSec": 0, "endSec": 2, "overlayText": "ONLY REAL FANS GET THIS", "overlayColor": "#FFFFFF"},
    {"sceneId": "countdown", "startSec": 2, "endSec": 6, "overlayText": "WHO IS IT?", "overlayColor": "#FFD700"},
    {"sceneId": "reveal", "startSec": 6, "endSec": 10, "overlayText": "Answer: ${card.player}", "overlayColor": "#00FF88"},
    {"sceneId": "cta", "startSec": 10, "endSec": 12, "overlayText": "Play PackPTS.com", "overlayColor": "#FFFFFF"}
  ],
  "cards": [{"cardId": "${card.id}", "player": "${card.player}", "set": "${card.set}", "year": ${card.year}, "imageUrl": "${card.imageUrl}", "difficulty": "${card.difficulty}", "era": "${card.era}"}],
  "engagement_goal": "comments",
  "safety_flags": { "no_gambling_language": true, "no_prize_guarantees": true }
}

IMPORTANT: Return ONLY valid JSON. The "hook" should be catchy and the script should build suspense.`;
}

export function DIFFICULTY_LADDER_PROMPT(date: string, cards: SelectedCard[]): string {
  const [easy, medium, hard] = cards;
  return `Create a TikTok "Difficulty Ladder" video package for ${date}.
Format: Show 3 masked baseball cards of increasing difficulty: Easy → Medium → Impossible.

${cardContext(cards)}

The video is 15 seconds:
- 0-3s: Easy card (masked) + "EASY" label
- 3-6s: Reveal overlay for easy card
- 6-9s: Medium card (masked) + "MEDIUM" label
- 9-12s: Reveal overlay for medium card
- 12-15s: Impossible card (masked) + "IMPOSSIBLE" label + CTA

Return STRICT JSON:
{
  "hook": "Easy. Medium. IMPOSSIBLE. Can you name all 3?",
  "script": "Full voiceover script for the 15s video",
  "on_screen_text": ["EASY", "${easy?.player || 'Player 1'}", "MEDIUM", "${medium?.player || 'Player 2'}", "IMPOSSIBLE", "${hard?.player || 'Player 3'}", "PackPTS.com"],
  "caption": "Under 200 char caption",
  "hashtags": ["#packpts", "#baseballcards", "#difficultyladder", "#sportscards", "#baseballtrivia", "#sportstrivia", "#mlb", "#cardcollector"],
  "cta": "Can you beat the ladder? Play at PackPTS.com!",
  "thumbnail_text": "Easy Medium IMPOSSIBLE",
  "format_notes": "15s vertical video. 3 cards shown sequentially with reveals.",
  "audio_notes": "Escalating intensity music, level-up sound effects",
  "asset_refs": [${cards.map(c => `{"type": "card_image", "card_id": "${c.id}", "url": "${c.imageUrl}"}`).join(",")}],
  "legal_safe": { "no_gambling_language": true, "no_prize_guarantees": true },
  "dedupe_key": "${date}:difficulty_ladder:${cards.map(c => c.id).join(":")}",
  "format_id": "difficulty_ladder",
  "render_template_id": "difficulty_ladder",
  "scenes": [
    {"sceneId": "easy", "startSec": 0, "endSec": 3, "overlayText": "EASY", "overlayColor": "#00FF88"},
    {"sceneId": "easy_reveal", "startSec": 3, "endSec": 6, "overlayText": "${easy?.player || 'Player 1'}", "overlayColor": "#00FF88"},
    {"sceneId": "medium", "startSec": 6, "endSec": 9, "overlayText": "MEDIUM", "overlayColor": "#FFD700"},
    {"sceneId": "medium_reveal", "startSec": 9, "endSec": 12, "overlayText": "${medium?.player || 'Player 2'}", "overlayColor": "#FFD700"},
    {"sceneId": "impossible_cta", "startSec": 12, "endSec": 15, "overlayText": "IMPOSSIBLE", "overlayColor": "#FF4444"}
  ],
  "cards": [${cards.map(c => `{"cardId": "${c.id}", "player": "${c.player}", "set": "${c.set}", "year": ${c.year}, "imageUrl": "${c.imageUrl}", "difficulty": "${c.difficulty}", "era": "${c.era}"}`).join(",")}],
  "engagement_goal": "replays",
  "safety_flags": { "no_gambling_language": true, "no_prize_guarantees": true }
}

IMPORTANT: Return ONLY valid JSON. Make the script build excitement through each difficulty level.`;
}

export function MEMORY_SHOCK_PROMPT(date: string, cards: SelectedCard[]): string {
  const card = cards[0];
  return `Create a TikTok "Memory Shock" video package for ${date}.
Format: "Remember this guy?" Show a masked card of a mid-tier nostalgic player with multiple choice.

The card is: "${card.player}" from ${card.set} (${card.year}).

The video is 12 seconds:
- 0-3s: "REMEMBER THIS GUY?" + masked card
- 3-7s: "Where did he play?" + 3 team options overlay
- 7-10s: Reveal the answer via overlay text
- 10-12s: CTA + "Streaks are live"

Return STRICT JSON:
{
  "hook": "REMEMBER THIS GUY? 🤔",
  "script": "Full voiceover script",
  "on_screen_text": ["REMEMBER THIS GUY?", "Where did he play?", "A) Team 1", "B) Team 2", "C) Team 3", "Answer: ${card.player}", "Streaks are LIVE on PackPTS"],
  "caption": "Under 200 char caption",
  "hashtags": ["#packpts", "#baseballcards", "#rememberthisguy", "#nostalgia", "#sportscards", "#throwback", "#mlb", "#baseballtrivia"],
  "cta": "Test your memory at PackPTS.com - link in bio!",
  "thumbnail_text": "Remember This Guy?",
  "format_notes": "12s vertical. Multiple choice overlay mid-video.",
  "audio_notes": "Nostalgic intro music, quiz show sound effects",
  "asset_refs": [{"type": "card_image", "card_id": "${card.id}", "url": "${card.imageUrl}"}],
  "legal_safe": { "no_gambling_language": true, "no_prize_guarantees": true },
  "dedupe_key": "${date}:memory_shock:${card.id}",
  "format_id": "memory_shock",
  "render_template_id": "memory_shock",
  "scenes": [
    {"sceneId": "hook", "startSec": 0, "endSec": 3, "overlayText": "REMEMBER THIS GUY?", "overlayColor": "#FFFFFF"},
    {"sceneId": "prompt", "startSec": 3, "endSec": 7, "overlayText": "Where did he play?", "overlayColor": "#FFD700"},
    {"sceneId": "reveal", "startSec": 7, "endSec": 10, "overlayText": "Answer: ${card.player}", "overlayColor": "#00FF88"},
    {"sceneId": "cta", "startSec": 10, "endSec": 12, "overlayText": "Streaks are LIVE", "overlayColor": "#FFFFFF"}
  ],
  "cards": [{"cardId": "${card.id}", "player": "${card.player}", "set": "${card.set}", "year": ${card.year}, "imageUrl": "${card.imageUrl}", "difficulty": "${card.difficulty}", "era": "${card.era}"}],
  "engagement_goal": "shares",
  "safety_flags": { "no_gambling_language": true, "no_prize_guarantees": true }
}

IMPORTANT: Return ONLY valid JSON. Make up 3 plausible team options (one correct).`;
}

export function PACK_PULL_DRAMA_PROMPT(date: string, cards: SelectedCard[]): string {
  const card = cards[0];
  return `Create a TikTok "Pack Pull Drama" video package for ${date}.
Format: Simulated digital pack opening with dramatic reveal cadence.

The revealed card is: "${card.player}" from ${card.set} (${card.year}).

The video is 15 seconds:
- 0-5s: "Pack opening" dramatic buildup (fast cuts, zoom effects on blurred card)
- 5-12s: "Big reveal" - still masked card but overlay reveals the answer
- 12-15s: CTA

Return STRICT JSON:
{
  "hook": "Let's rip this pack... 🔥",
  "script": "Full voiceover script with dramatic buildup",
  "on_screen_text": ["PACK PULL TIME", "What did we get?", "3", "2", "1", "IT'S ${card.player.toUpperCase()}!", "Play PackPTS.com"],
  "caption": "Under 200 char caption",
  "hashtags": ["#packpts", "#baseballcards", "#packpull", "#packopening", "#sportscards", "#cardcollector", "#mlb", "#wax"],
  "cta": "Open your own packs at PackPTS.com!",
  "thumbnail_text": "Pack Pull Time",
  "format_notes": "15s vertical. Dramatic zoom/cut effects. High energy.",
  "audio_notes": "Pack ripping sounds, dramatic buildup, celebration on reveal",
  "asset_refs": [{"type": "card_image", "card_id": "${card.id}", "url": "${card.imageUrl}"}],
  "legal_safe": { "no_gambling_language": true, "no_prize_guarantees": true },
  "dedupe_key": "${date}:pack_pull_drama:${card.id}",
  "format_id": "pack_pull_drama",
  "render_template_id": "pack_pull_drama",
  "scenes": [
    {"sceneId": "pack_open", "startSec": 0, "endSec": 5, "overlayText": "PACK PULL TIME 🔥", "overlayColor": "#FF6B35"},
    {"sceneId": "reveal", "startSec": 5, "endSec": 12, "overlayText": "${card.player}", "overlayColor": "#00FF88"},
    {"sceneId": "cta", "startSec": 12, "endSec": 15, "overlayText": "Play PackPTS.com", "overlayColor": "#FFFFFF"}
  ],
  "cards": [{"cardId": "${card.id}", "player": "${card.player}", "set": "${card.set}", "year": ${card.year}, "imageUrl": "${card.imageUrl}", "difficulty": "${card.difficulty}", "era": "${card.era}"}],
  "engagement_goal": "shares",
  "safety_flags": { "no_gambling_language": true, "no_prize_guarantees": true }
}

IMPORTANT: Return ONLY valid JSON. Make the script build drama and suspense.`;
}

export function LEADERBOARD_FLEX_PROMPT(
  date: string,
  topPlayers: { username: string; score: number; correct: number; streak?: number }[],
  cards: SelectedCard[]
): string {
  const playerList = topPlayers.map((p, i) =>
    `${i + 1}. ${p.username} - ${p.score} pts (${p.correct}/5 correct${p.streak ? `, ${p.streak}-day streak` : ""})`
  ).join("\n");

  return `Create a TikTok "Leaderboard Flex" video package for ${date}.
Format: Showcase real Daily 5 top performers. Social proof format.

Top performers:
${playerList}

The video is 12 seconds:
- 0-3s: "DAILY 5 TOP PLAYERS" intro overlay
- 3-9s: Show top 2-3 winners with username + score + streak overlays
- 9-12s: CTA "Can you beat them tonight? PackPTS.com"

Return STRICT JSON:
{
  "hook": "These players DOMINATED the Daily 5 today 🏆",
  "script": "Full voiceover script celebrating the winners",
  "on_screen_text": ["DAILY 5 TOP PLAYERS", ${topPlayers.map(p => `"${p.username}: ${p.score} pts"`).join(", ")}, "Can YOU beat them?", "PackPTS.com"],
  "caption": "Under 200 char caption",
  "hashtags": ["#packpts", "#daily5", "#leaderboard", "#baseballcards", "#sportscards", "#champion", "#baseballtrivia", "#mlb"],
  "cta": "Think you can beat them? Play the Daily 5 - link in bio!",
  "thumbnail_text": "Today's Champions",
  "format_notes": "12s vertical. Leaderboard reveal format.",
  "audio_notes": "Victory fanfare, celebration sounds, crowd cheering",
  "asset_refs": [${cards.length > 0 ? cards.map(c => `{"type": "card_image", "card_id": "${c.id}", "url": "${c.imageUrl}"}`).join(",") : ""}],
  "legal_safe": { "no_gambling_language": true, "no_prize_guarantees": true },
  "dedupe_key": "${date}:leaderboard_flex",
  "format_id": "leaderboard_flex",
  "render_template_id": "leaderboard_flex",
  "scenes": [
    {"sceneId": "intro", "startSec": 0, "endSec": 3, "overlayText": "DAILY 5 TOP PLAYERS 🏆", "overlayColor": "#FFD700"},
    {"sceneId": "players", "startSec": 3, "endSec": 9, "overlayText": "${topPlayers.map(p => `${p.username}: ${p.score}`).join(" | ")}", "overlayColor": "#FFFFFF"},
    {"sceneId": "cta", "startSec": 9, "endSec": 12, "overlayText": "Can YOU beat them? PackPTS.com", "overlayColor": "#00FF88"}
  ],
  "engagement_goal": "conversion",
  "safety_flags": { "no_gambling_language": true, "no_prize_guarantees": true }
}

IMPORTANT: Return ONLY valid JSON. Celebrate the winners and create FOMO.`;
}

export function ERA_WARS_PROMPT(date: string, cards: SelectedCard[]): string {
  const [card1, card2] = cards;
  const era1Label = `${card1.era.replace("s", "")}s`;
  const era2Label = `${card2.era.replace("s", "")}s`;

  return `Create a TikTok "Era Wars" video package for ${date}.
Format: Pit cards from different eras against each other. Which era produced better players?

${cardContext(cards)}

The video is 12 seconds:
- 0-3s: "ERA WARS: ${era1Label} vs ${era2Label}" intro overlay
- 3-9s: Show two masked cards side by side + "Which era wins?" overlay
- 9-12s: CTA + "Comment your era"

Return STRICT JSON:
{
  "hook": "${era1Label} vs ${era2Label} - which era had BETTER cards? 🔥",
  "script": "Full voiceover script comparing the eras",
  "on_screen_text": ["ERA WARS", "${era1Label} vs ${era2Label}", "Which era wins?", "Comment your pick!", "PackPTS.com"],
  "caption": "Under 200 char caption asking viewers to pick an era",
  "hashtags": ["#packpts", "#baseballcards", "#erawars", "#sportscards", "#vintagevsmodern", "#mlb", "#baseballtrivia", "#cardcollector"],
  "cta": "Pick your era and play at PackPTS.com!",
  "thumbnail_text": "${era1Label} vs ${era2Label}",
  "format_notes": "12s vertical. Split-screen or sequential card comparison.",
  "audio_notes": "Battle/competition music, whoosh transitions",
  "asset_refs": [${cards.map(c => `{"type": "card_image", "card_id": "${c.id}", "url": "${c.imageUrl}"}`).join(",")}],
  "legal_safe": { "no_gambling_language": true, "no_prize_guarantees": true },
  "dedupe_key": "${date}:era_wars:${cards.map(c => c.id).join(":")}",
  "format_id": "era_wars",
  "render_template_id": "era_wars",
  "scenes": [
    {"sceneId": "intro", "startSec": 0, "endSec": 3, "overlayText": "ERA WARS: ${era1Label} vs ${era2Label}", "overlayColor": "#FF4444"},
    {"sceneId": "matchup", "startSec": 3, "endSec": 9, "overlayText": "Which era wins?", "overlayColor": "#FFD700"},
    {"sceneId": "cta", "startSec": 9, "endSec": 12, "overlayText": "Comment your era! PackPTS.com", "overlayColor": "#FFFFFF"}
  ],
  "cards": [${cards.map(c => `{"cardId": "${c.id}", "player": "${c.player}", "set": "${c.set}", "year": ${c.year}, "imageUrl": "${c.imageUrl}", "difficulty": "${c.difficulty}", "era": "${c.era}"}`).join(",")}],
  "engagement_goal": "comments",
  "safety_flags": { "no_gambling_language": true, "no_prize_guarantees": true }
}

IMPORTANT: Return ONLY valid JSON. Make the comparison fun and debatable.`;
}
