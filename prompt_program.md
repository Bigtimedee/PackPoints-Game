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

**Signup conversion rate** — clicks that result in a new account registration.
Secondary: engagement rate (likes + shares / impressions). We do not optimize for
raw impressions alone.

---

## New user incentive (always include in acquisition-type posts)

Every new PackPTS account receives **250 free PackPTS on signup** — no purchase required.
Any post targeting new users MUST include a reference to this offer.
Exact phrasing examples (vary, do not repeat verbatim):
- "New players get 250 free points on signup."
- "250 free PackPTS for every new account. No purchase needed."
- "Sign up free and we credit 250 PackPTS straight to your wallet."

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

The evolution agent should generate 3 distinct variants (A, B, C) for each content type.
Each generation should try to outperform the last winning variant. Ideas to explore:

- **Urgency** — time pressure ("leaderboard resets in 24 hours")
- **Social proof** — real player counts, real streak numbers
- **Challenge framing** — direct personal challenge to the reader
- **Curiosity gap** — tease the card without naming it
- **Identity appeal** — "if you collect cards, you already know this"
- **Loss aversion** — streak at risk, daily challenge expiring

Avoid: generic sports copy, vague promises, overuse of hashtags in the body.

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
