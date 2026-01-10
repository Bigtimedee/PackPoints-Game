# PackPoints Monetization Plan

## Overview

This document outlines the implementation plan for monetizing PackPoints through a virtual currency system (PackPTS), product catalog, in-app purchases, subscription verification, entitlement gating, admin controls, and analytics.

---

## 1. PackPTS Wallet + Ledger

### Purpose
Create a virtual currency system where users can earn, purchase, and spend PackPTS.

### Database Schema

```sql
-- User wallet balance (denormalized for fast reads)
ALTER TABLE users ADD COLUMN packpts_balance INTEGER NOT NULL DEFAULT 0;

-- Transaction ledger for audit trail
CREATE TABLE packpts_ledger (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,  -- positive = credit, negative = debit
  balance_after INTEGER NOT NULL,
  transaction_type VARCHAR NOT NULL,  -- 'game_reward', 'purchase', 'redemption', 'admin_adjustment', 'subscription_bonus'
  reference_id VARCHAR,  -- links to game session, purchase, or redemption
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ledger_user ON packpts_ledger(user_id);
CREATE INDEX idx_ledger_created ON packpts_ledger(created_at);
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/wallet/balance` | Get current PackPTS balance |
| GET | `/api/wallet/history` | Get transaction history (paginated) |
| POST | `/api/wallet/redeem` | Redeem PackPTS for rewards |

### Implementation Notes
- All balance changes go through ledger (no direct balance updates)
- Use database transactions to ensure atomicity
- Store `balance_after` for easy reconciliation
- Game rewards calculated: `max(50, 100 + (100 - popularity) * 4)`

---

## 2. Product Catalog

### Purpose
Define purchasable items including PackPTS packs, subscriptions, and premium features.

### Database Schema

```sql
CREATE TABLE products (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR UNIQUE NOT NULL,  -- 'packpts_500', 'packpts_2000', 'premium_monthly'
  name VARCHAR NOT NULL,
  description TEXT,
  product_type VARCHAR NOT NULL,  -- 'packpts_pack', 'subscription', 'one_time'
  packpts_amount INTEGER,  -- for packpts_pack type
  price_cents INTEGER NOT NULL,
  currency VARCHAR DEFAULT 'USD',
  apple_product_id VARCHAR,  -- App Store product ID
  google_product_id VARCHAR,  -- Google Play product ID
  stripe_price_id VARCHAR,  -- Stripe price ID for web
  is_active BOOLEAN DEFAULT true,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE subscription_plans (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id VARCHAR REFERENCES products(id),
  name VARCHAR NOT NULL,  -- 'PackPoints Pro', 'PackPoints Elite'
  interval VARCHAR NOT NULL,  -- 'monthly', 'yearly'
  features JSONB,  -- ['unlimited_games', 'bonus_packpts', 'exclusive_cards']
  monthly_bonus_packpts INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true
);
```

### Initial Product Catalog

| SKU | Name | Type | PackPTS | Price |
|-----|------|------|---------|-------|
| packpts_100 | Starter Pack | packpts_pack | 100 | $0.99 |
| packpts_500 | Value Pack | packpts_pack | 500 | $4.99 |
| packpts_1200 | Super Pack | packpts_pack | 1,200 | $9.99 |
| packpts_2500 | Mega Pack | packpts_pack | 2,500 | $19.99 |
| pro_monthly | Pro Monthly | subscription | 200/mo bonus | $4.99/mo |
| pro_yearly | Pro Yearly | subscription | 200/mo bonus | $39.99/yr |

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/products` | List active products |
| GET | `/api/products/:sku` | Get product details |
| GET | `/api/subscriptions` | List subscription plans |

---

## 3. IAP/Subscription Verification

### Purpose
Verify purchases from Apple App Store, Google Play, and Stripe for web.

### Database Schema

```sql
CREATE TABLE purchases (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  product_id VARCHAR REFERENCES products(id),
  platform VARCHAR NOT NULL,  -- 'apple', 'google', 'stripe'
  platform_transaction_id VARCHAR NOT NULL,
  platform_receipt TEXT,  -- encrypted/hashed receipt data
  status VARCHAR NOT NULL,  -- 'pending', 'verified', 'failed', 'refunded'
  amount_cents INTEGER,
  currency VARCHAR,
  verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE subscriptions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  product_id VARCHAR REFERENCES products(id),
  platform VARCHAR NOT NULL,
  platform_subscription_id VARCHAR NOT NULL,
  status VARCHAR NOT NULL,  -- 'active', 'cancelled', 'expired', 'grace_period'
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_subscriptions_user_active ON subscriptions(user_id) WHERE status = 'active';
```

### Verification Flow

```
1. Client initiates purchase → Platform SDK
2. Platform returns receipt/token
3. Client sends receipt to /api/purchases/verify
4. Server verifies with platform API:
   - Apple: App Store Server API
   - Google: Google Play Developer API
   - Stripe: Webhook + API verification
5. On success:
   - Create purchase record
   - Credit PackPTS to wallet (via ledger)
   - Return success to client
6. On failure:
   - Log attempt
   - Return error
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/purchases/verify` | Verify and process purchase |
| POST | `/api/subscriptions/verify` | Verify subscription status |
| POST | `/api/webhooks/stripe` | Stripe webhook handler |
| POST | `/api/webhooks/apple` | Apple server notifications |
| POST | `/api/webhooks/google` | Google RTDN handler |

### Security Considerations
- Never trust client-side purchase validation
- Store receipts encrypted
- Rate limit verification endpoints
- Use webhook signatures for all platforms
- Implement idempotency for duplicate receipts

---

## 4. Entitlement Gating

### Purpose
Control access to premium features based on subscription status or PackPTS balance.

### Entitlement Types

| Entitlement | Description | Check Method |
|-------------|-------------|--------------|
| `premium_cards` | Access to exclusive card sets | Subscription active |
| `unlimited_games` | No daily game limit | Subscription active |
| `bonus_multiplier` | 1.5x PackPTS on games | Subscription active |
| `1v1_mode` | Access to 1v1 matches | Subscription OR 100 PackPTS |
| `tournament_entry` | Join tournaments | 500 PackPTS entry fee |

### Implementation

```typescript
// Middleware for entitlement checks
const requireEntitlement = (entitlement: string) => async (req, res, next) => {
  const user = await getAuthenticatedUser(req);
  const hasAccess = await checkEntitlement(user.id, entitlement);
  
  if (!hasAccess) {
    return res.status(403).json({
      error: 'entitlement_required',
      entitlement,
      upgradeUrl: '/marketplace'
    });
  }
  next();
};

// Usage in routes
app.post('/api/game/start-1v1', requireEntitlement('1v1_mode'), ...);
app.post('/api/tournament/join', requireEntitlement('tournament_entry'), ...);
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/entitlements` | Get user's current entitlements |
| GET | `/api/entitlements/:name` | Check specific entitlement |

---

## 5. Admin Controls

### Purpose
Provide administrative tools for managing the monetization system.

### Admin Capabilities

| Feature | Description |
|---------|-------------|
| User Wallet Management | View/adjust user PackPTS balances |
| Transaction Auditing | View all ledger transactions |
| Product Management | CRUD operations on products |
| Subscription Management | View/cancel user subscriptions |
| Refund Processing | Process refunds and clawbacks |
| Analytics Dashboard | Revenue and usage metrics |

### Database Schema

```sql
CREATE TABLE admin_actions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id VARCHAR NOT NULL REFERENCES users(id),
  action_type VARCHAR NOT NULL,  -- 'balance_adjustment', 'refund', 'subscription_cancel'
  target_user_id VARCHAR REFERENCES users(id),
  details JSONB,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### API Endpoints (Admin Only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/wallets` | List all user wallets |
| POST | `/api/admin/wallets/:userId/adjust` | Adjust user balance |
| GET | `/api/admin/transactions` | View all transactions |
| GET | `/api/admin/revenue` | Revenue analytics |
| POST | `/api/admin/refund/:purchaseId` | Process refund |
| PUT | `/api/admin/products/:id` | Update product |
| DELETE | `/api/admin/subscriptions/:id` | Cancel subscription |

### Security
- All admin endpoints require `isAdmin: true`
- All actions logged to `admin_actions` table
- Sensitive operations require confirmation

---

## 6. Analytics

### Purpose
Track monetization metrics for business decisions.

### Key Metrics

| Category | Metrics |
|----------|---------|
| Revenue | Daily/Monthly revenue, ARPU, LTV |
| Conversions | Free-to-paid rate, subscription rate |
| Retention | Subscriber churn, renewal rate |
| Engagement | Games per user, PackPTS earned vs spent |
| Products | Best sellers, revenue by product |

### Database Schema

```sql
CREATE TABLE analytics_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR REFERENCES users(id),
  event_type VARCHAR NOT NULL,  -- 'purchase', 'game_complete', 'redemption'
  event_data JSONB,
  session_id VARCHAR,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_analytics_type_date ON analytics_events(event_type, created_at);

-- Aggregated daily metrics (computed by scheduled job)
CREATE TABLE analytics_daily (
  date DATE PRIMARY KEY,
  total_revenue_cents INTEGER,
  unique_purchasers INTEGER,
  total_purchases INTEGER,
  new_subscribers INTEGER,
  churned_subscribers INTEGER,
  active_users INTEGER,
  games_played INTEGER,
  packpts_earned INTEGER,
  packpts_spent INTEGER
);
```

### Events to Track

| Event | Trigger | Data |
|-------|---------|------|
| `user_registered` | New account | signup method |
| `game_started` | Game begins | mode, questions |
| `game_completed` | Game ends | score, packpts earned |
| `purchase_initiated` | User taps buy | product, platform |
| `purchase_completed` | Verified purchase | product, amount |
| `subscription_started` | New subscription | plan |
| `subscription_cancelled` | Cancellation | reason |
| `redemption_requested` | PackPTS redemption | amount, reward |

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/analytics/overview` | Dashboard metrics |
| GET | `/api/admin/analytics/revenue` | Revenue breakdown |
| GET | `/api/admin/analytics/users` | User metrics |
| GET | `/api/admin/analytics/products` | Product performance |

---

## Implementation Priority

### Phase 1: Foundation (Week 1)
1. PackPTS wallet + ledger schema
2. Integrate wallet with existing game rewards
3. Basic admin wallet controls

### Phase 2: Products (Week 2)
1. Product catalog schema + API
2. Stripe integration for web purchases
3. Purchase verification flow

### Phase 3: Subscriptions (Week 3)
1. Subscription plans + entitlements
2. Subscription verification
3. Entitlement gating middleware

### Phase 4: Mobile IAP (Week 4)
1. Apple App Store integration
2. Google Play integration
3. Cross-platform receipt verification

### Phase 5: Analytics & Polish (Week 5)
1. Analytics event tracking
2. Admin analytics dashboard
3. Revenue reporting

---

## Technical Dependencies

| Dependency | Purpose |
|------------|---------|
| Stripe SDK | Web payments |
| Apple App Store Server API | iOS receipt verification |
| Google Play Developer API | Android receipt verification |
| node-schedule | Subscription renewal checks |
| Analytics service | Event aggregation (optional) |

---

## Security Checklist

- [ ] All purchase receipts verified server-side
- [ ] Webhook signatures validated
- [ ] Rate limiting on verification endpoints
- [ ] Admin actions logged with audit trail
- [ ] Sensitive data encrypted at rest
- [ ] PCI compliance for payment data
- [ ] GDPR compliance for EU users
