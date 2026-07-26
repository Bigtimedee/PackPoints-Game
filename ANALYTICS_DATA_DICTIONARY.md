# PackPTS Collector Intelligence — Data Dictionary & Lineage

> Diligence reference (ANALYTICS_PROMPTS.md, Prompt 8). Every published index traces to its formula and its source events. The asset is PII-free by construction and separates a credible "clean" layer from the raw layer.

## Governance guarantees

- **PII-free:** analytics tables key users only on `user_hash` = `HMAC-SHA256(userId, SECRET_SALT)`. No email/phone/name/IP/address columns exist in any `analytics_*` table. Verified continuously by `GET /api/admin/analytics/governance` (piiAudit).
- **Clean vs raw:** every event carries `is_clean`; users whose `user_risk_state.status <> 'NORMAL'` (flagged/frozen/bot) are `is_clean = false`. All indices compute over the clean layer by default; the raw layer is available via `?clean=false`.
- **Reproducible:** marts are a pure function of the append-only event spine (full per-day recompute), so any index can be rebuilt from source.

## Source layer

| Table | Grain | Source |
|---|---|---|
| `analytics_events` | one row per user action | fire-and-forget `track()` at gameplay/reveal/commerce call sites |
| `card_price_history` | (day, player, year) | daily CardHedge snapshot worker |

Event types: `answer_submitted` (outcome, latency), `listing_click`, `set_started`, `set_published`.

## Mart layer (derived, daily)

| Mart | Key | Derivation |
|---|---|---|
| `card_attention_daily` | (player_key, day, is_clean) | plays/correct/incorrect/unique_users/latency from `answer_submitted` |
| `set_engagement_daily` | (game_set_id, day, is_clean) | starts + plays + reach per set |
| `commerce_funnel_daily` | (game_set_id, day, is_clean) | listing clicks per set |

## Index layer (the IP)

| Index | Formula | Source |
|---|---|---|
| **Card Attention Index (CAI)** | 0–100 normalized recency-weighted signal, `Σ plays_d · 0.5^(age/14)`, scaled to cohort max | `card_attention_daily` |
| **Recognition Index (RI)** | `correct / attempts`, Wilson 95% CI, ≥20-attempt floor; breakout if velocity ≥ +10pts | `card_attention_daily` |
| **Commerce Intent Funnel** | correct → clicks → purchases; CTR, conversion, attributed revenue | marts + `outbound_clicks` + `attributed_purchases` |
| **Attention Alpha** | per-player Pearson corr of attention(t) vs price(t+lag), lag 0–14d, aggregated | `card_attention_daily` × `card_price_history` |
| **Trending / Market Pulse** | attention velocity, window vs prior window | `card_attention_daily`, `set_engagement_daily` |

## Data-quality monitors (`dataQuality`)

- mart-vs-raw reconciliation (`martReconciled`)
- null `player_key` rate on answer events (< 5% healthy)
- event + price-capture freshness
