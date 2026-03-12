# Railway Environment Variables Setup

This guide covers all environment variables needed to run PackPTS on Railway.

## Required Variables (app will crash without these)

| Variable | Description | Where to get it |
|----------|-------------|-----------------|
| `DATABASE_URL` | PostgreSQL connection string | Railway PostgreSQL plugin → Connect tab |
| `SESSION_SECRET` | Random secret for session signing | Generate: `openssl rand -hex 32` |

## Stripe (Payments)

| Variable | Description | Where to get it |
|----------|-------------|-----------------|
| `STRIPE_SECRET_KEY` | Stripe secret key | [Stripe Dashboard](https://dashboard.stripe.com) → Developers → API Keys |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret | Stripe Dashboard → Webhooks → Signing Secret |

## Authentication (WorkOS)

| Variable | Description | Where to get it |
|----------|-------------|-----------------|
| `WORKOS_API_KEY` | WorkOS API key | [WorkOS Dashboard](https://dashboard.workos.com) → API Keys |
| `WORKOS_CLIENT_ID` | WorkOS client ID | WorkOS Dashboard → Applications |

## AI Content Generation (Social Media Posting)

| Variable | Description | Where to get it |
|----------|-------------|-----------------|
| `OPENAI_API_KEY` | OpenAI API key for post generation | [OpenAI Platform](https://platform.openai.com/api-keys) → Create new secret key |

**Without this key:** Social media posts will use template-based fallback content instead of AI-generated content. The app will continue to function normally.

## Social Media Posting

| Variable | Description |
|----------|-------------|
| `INSTAGRAM_ACCESS_TOKEN` | Instagram Business account token |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Facebook Page access token |
| `TIKTOK_ACCESS_TOKEN` | TikTok Business account token |
| `SOCIAL_MEDIA_AGENT_ENABLED` | Set to `true` to enable autonomous posting |

## Optional Features

| Variable | Default | Description |
|----------|---------|-------------|
| `SHOW_API_DOCS` | `false` | Set to `true` to expose `/api/docs` in production |
| `IMAGE_VALIDATION_ENABLED` | `true` | Set to `false` to disable image validation job |
| `CARD_POOL_REFRESH_ENABLED` | `true` | Set to `false` to disable card pool refresh |
| `STALE_REDEMPTION_CLEANUP_ENABLED` | `true` | Set to `false` to disable cleanup job |
| `RISK_PIPELINE_ENABLED` | `true` | Set to `false` to disable risk pipeline |
| `DB_POOL_MAX` | `10` | Maximum DB connection pool size |
| `ALLOWED_ORIGINS` | `http://localhost:5000` | Comma-separated allowed CORS origins |

## Adding Variables to Railway

1. Open your Railway project dashboard
2. Click on your service (the Node.js server)
3. Go to **Variables** tab
4. Click **+ New Variable**
5. Enter the variable name and value
6. Railway will automatically redeploy your service

## Verifying Your Setup

After deploying, check the health endpoint:
```
curl https://your-app.railway.app/health
```

A healthy response looks like:
```json
{
  "status": "ok",
  "database": "connected",
  "stripe": "live"
}
```

Any `[Startup] WARNING` messages in your Railway logs indicate missing optional variables.
