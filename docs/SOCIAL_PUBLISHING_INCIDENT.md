# Social Publishing Incident Report
## PackPTS X Account: Text-Only Posts With Visual Copy

**Date:** 2026-04-14
**Severity:** Brand-critical
**Status:** Remediated (see implementation below)

---

## 1. Observed Problem

Posts on the PlayPackPTS X account are publishing copy that references visual content — card images, challenge visuals, leaderboard graphics — but zero media is attached. Examples observed:

- "Can you guess this iconic card? Don't wait. Show off your knowledge before the leaderboard resets!"
- "Today's spot is up for grabs"
- "The hottest baseball cards on the market right now — can you name them all?"

These posts reference a **visual stimulus the audience cannot see**, making them incoherent and the brand look broken.

---

## 2. Root Cause Analysis

### 2a. Twitter publisher ignores `imageBuffer` (PRIMARY cause)

**File:** `server/services/socialMedia/publisher/twitter.ts:40-42`

```typescript
// TODO: Upgrade to Elevated API access for media uploads
// imageBuffer is accepted but media upload is not attempted without Elevated access
const response = await client.v2.tweet({
  text: fullText,
});
```

The `publishTweet()` function accepts an `imageBuffer?: Buffer` parameter but **silently ignores it**. Every Twitter post is published text-only regardless of whether an image was composed and stored. The comment says "waiting for Elevated API access" — but the copy continued referencing cards as if media were attached.

### 2b. Scheduler calls `publishTweet` without the image buffer (SECONDARY cause)

**File:** `server/services/socialMedia/scheduler.ts:269`

```typescript
platformPostId = await publishTweet(post.copyText, post.hashtags ?? []);
```

Even after Elevated API access is granted, the image buffer is **never passed** to `publishTweet`. The scheduler reads `post.composedImagePath` for TikTok (line 273) but passes nothing for Twitter. The composed image is stored in the DB row but never forwarded to the publish call.

### 2c. No guard against publishing visual copy without media

The content generator produces copy with explicit visual references ("Can you guess this card?", "The hottest cards on the market") for content types like `TRIVIA_CARD` and `MARKET_PRICE_SPOTLIGHT`. These types inherently require an attached image to be coherent.

There is **no preflight check** that blocks a post from publishing when:
- The copy contains visual-reference language, AND
- No media is attached

### 2d. Image composition failure silently degrades to text-only

**File:** `server/services/socialMedia/scheduler.ts:118-121`

```typescript
} catch (imageErr) {
  if (platform === "TIKTOK") throw imageErr; // TikTok requires an image
  logger.warn("image_compose_skipped_text_only", { platform, hour, error: String(imageErr) });
}
```

When CardHedge is unreachable or image composition fails for Twitter, the post is queued as text-only with copy that still references a card. TikTok is protected; Twitter is not.

### 2e. Growth Agent has no media requirement enforcement

`growthContentItems` has no `media_required`, `media_status`, or `preflight_passed` fields. Items with X-platform copy referencing visual content enter the publishing queue with no mechanism to block them if no asset is attached.

---

## 3. Affected Flows

| Flow | System | Media Guard? |
|------|--------|-------------|
| Automated Twitter post (Social Media Agent) | `scheduler.ts` → `twitter.ts` | NO |
| Automated TikTok post (Social Media Agent) | `scheduler.ts` → `tiktok.ts` | Partial (requires path, not validated) |
| Manual queue (Growth Agent, X platform) | `growth.routes.ts` mark-posted | NO |
| Image compose failure fallback (Twitter) | `scheduler.ts:118` | NO — degrades silently |

---

## 4. Remediation Plan

Implemented in this commit:

1. **Schema:** Add `mediaRequired`, `mediaStatus`, `publishBlockReason`, `preflightPassed` to `socialPosts`; add `mediaRequired`, `mediaStatus`, `mediaAssetCount`, `publishBlockReason`, `preflightPassed` to `growthContentItems`
2. **Preflight validator:** `validatePostForPublishing()` — blocks publication when visual copy exists without media
3. **Language detector:** `detectsVisualReference()` — identifies copy that references cards, images, visuals
4. **State machine:** New statuses — `MEDIA_PENDING`, `PREFLIGHT_FAILED`, `BLOCKED` prevent text-only publish
5. **Twitter publisher fix:** Pass image buffer when available; throw when `mediaRequired=true` and no buffer
6. **Scheduler fix:** Pass composed image buffer to `publishTweet`; mark `BLOCKED` instead of queuing when image compose fails and copy is visual
7. **Audit tool:** `auditBlockedPosts()` — finds and blocks queued posts with missing media
8. **ensureSchema migration:** All new columns added idempotently on startup

---

## 5. What Should Have Been Caught

- The `publishTweet` TODO comment was left in production code for an indefinite period while visual-reference copy was being generated and published
- No integration test verified that visual content types result in media-attached posts
- The text-only fallback for Twitter image failures was too broad — it should only apply to content types that are not inherently visual
