# PackPTS Prompt Evolution Program

This file is the human-editable instruction set for the autonomous prompt evolution loop.
It plays the same role as `program.md` in Karpathy's autoresearch: the agent reads this,
studies what copy has won in A/B tests, and generates the next generation of variants.

You edit this file to steer the research direction. The agent handles the rest.

---

## Platform

PackPTS is a baseball card trivia game. Players identify cards from images to earn
redeemable points. It is free to play. The audience is baseball card collectors and
sports card enthusiasts aged 18-45, primarily on X/Twitter and TikTok.

Site URL: https://PackPTS.com

---

## The metric that matters

**Daily 5 ritual engagement** — players opening today's five. Auto X copy does not
optimize for signup-bonus conversion. Secondary: engagement rate (likes + shares /
impressions). We do not optimize for raw impressions alone.

---

## Marketing SoR (never violate — auto posts)

Organic reference: https://x.com/PlayPackPTS/status/2100232354249728403
Copy kit: `client/public/assets/x-hotfix-2026-09-13/CAPTIONS.md` (Daily 5 ritual / post2).

Auto-generated posts MUST be Daily 5 announcement or recap. Sparse hashtags only:
`#PackPTS` and `#Daily5` (max 2). CTA: packpts.com/daily.

**Banned in auto copy (hard reject at preflight):**
- Signup bonus / "250 free" PackPTS / "250 free pts" acquisition offers
- FOMO acquisition ("claim yours", "no catch", "no purchase needed", "expire tonight",
  "limited spots", "don't miss", "last chance")
- Hashtag dumps (more than 2 tags)

The in-product 250 PackPTS welcome bonus still exists on register. It must **not**
appear in autonomous social copy.

---

## Brand voice constraints (never violate these)

- Confident and direct. Short sentences.
- Never use hyphens in body copy.
- Never fabricate stats, scores, or player names. Use only real data pulled from the DB,
  or omit the claim entirely.
- Always end with the site URL on its own line.
- Twitter copy: 240 characters max for the body (before URL and hashtags).
- TikTok copy: 150 characters max for the body (before URL and hashtags).
- Do not use exclamation marks more than once per post.

---

## What to experiment with

The evolution agent should generate 3 distinct variants (A, B, C) for Daily 5
CHALLENGE posts only. Each generation should try to outperform the last winning
variant. Ideas to explore:

- **Ritual** — today's five is live / today's five is done
- **Streak** — keep the streak, come back tomorrow
- **Curiosity** — guess who, same five cards for everyone
- **Knowledge pays** — collector tone, never casino/FOMO

Avoid: generic sports copy, signup-bonus offers, urgency theater, hashtag dumps.

---

## Generation history guidance

Each generation should be meaningfully different from the last. Do not re-use the exact
phrasing of a prior winner. Instead, study why it won (urgency? social proof? brevity?)
and amplify that mechanic in a new way while keeping the brand voice constraints above.

---

## Output format

The agent must return a JSON object with this exact shape:

```json
{
  "contentType": "TRIVIA_CARD",
  "generation": 2,
  "rationale": "Prior winner used social proof (player count). This generation tests urgency + curiosity gap.",
  "variants": {
    "A": "Copy text here (body only, no URL, no hashtags)",
    "B": "Copy text here",
    "C": "Copy text here"
  }
}
```

Return one JSON object per content type. Do not include the URL or hashtags in the
variants — those are appended automatically.
