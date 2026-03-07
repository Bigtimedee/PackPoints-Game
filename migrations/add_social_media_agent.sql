-- Social Media Agent: new enums, tables, indexes, and seed data

-- Enums
DO $$ BEGIN
  CREATE TYPE social_platform AS ENUM ('TWITTER', 'TIKTOK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE social_post_status AS ENUM ('DRAFT', 'QUEUED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE social_content_type AS ENUM (
    'TRIVIA_CARD', 'LEADERBOARD_HIGHLIGHT', 'STREAK_MILESTONE',
    'MARKET_PRICE_SPOTLIGHT', 'NEW_USER_ACQUISITION', 'REWARD_ANNOUNCEMENT', 'CHALLENGE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ab_test_status AS ENUM ('RUNNING', 'CONCLUDED', 'INCONCLUSIVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE campaign_reward_type AS ENUM ('SIGNUP_BONUS', 'STREAK_REWARD', 'REFERRAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tables
CREATE TABLE IF NOT EXISTS social_posts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  platform social_platform NOT NULL,
  content_type social_content_type NOT NULL,
  status social_post_status NOT NULL DEFAULT 'DRAFT',
  ab_group VARCHAR(1),
  ab_test_id VARCHAR,
  campaign_id VARCHAR,
  card_id VARCHAR,
  card_image_url TEXT,
  composed_image_path TEXT,
  card_query_params JSONB,
  copy_text TEXT NOT NULL,
  hashtags TEXT[],
  scheduled_at TIMESTAMP NOT NULL,
  published_at TIMESTAMP,
  platform_post_id VARCHAR,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  fact_check_passed BOOLEAN NOT NULL DEFAULT FALSE,
  fact_check_log JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_platform_status ON social_posts (platform, status);
CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled ON social_posts (scheduled_at, status);
CREATE INDEX IF NOT EXISTS idx_social_posts_ab_test ON social_posts (ab_test_id);

CREATE TABLE IF NOT EXISTS post_analytics (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id VARCHAR NOT NULL REFERENCES social_posts(id),
  fetched_at TIMESTAMP DEFAULT NOW(),
  impressions INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  profile_visits INTEGER DEFAULT 0,
  new_signups_attributed INTEGER DEFAULT 0,
  conversion_rate REAL
);

CREATE INDEX IF NOT EXISTS idx_post_analytics_post_id ON post_analytics (post_id);

CREATE TABLE IF NOT EXISTS ab_tests (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id VARCHAR NOT NULL,
  content_type social_content_type NOT NULL,
  test_name VARCHAR NOT NULL,
  hypothesis TEXT,
  variant_a_description TEXT,
  variant_b_description TEXT,
  status ab_test_status NOT NULL DEFAULT 'RUNNING',
  winner VARCHAR(1),
  winning_metric VARCHAR,
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ab_tests_status ON ab_tests (status);

CREATE TABLE IF NOT EXISTS campaign_rewards (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id VARCHAR NOT NULL,
  reward_type campaign_reward_type NOT NULL,
  reward_description TEXT NOT NULL,
  reward_value VARCHAR NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from TIMESTAMP DEFAULT NOW(),
  valid_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_rewards_active ON campaign_rewards (is_active);

-- Seed initial campaign rewards
INSERT INTO campaign_rewards (campaign_id, reward_type, reward_description, reward_value, is_active)
SELECT 'new-user-acquisition-v1', 'SIGNUP_BONUS', 'Welcome bonus for new PackPTS registrations', '500', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM campaign_rewards WHERE campaign_id = 'new-user-acquisition-v1' AND reward_type = 'SIGNUP_BONUS'
);

INSERT INTO campaign_rewards (campaign_id, reward_type, reward_description, reward_value, is_active)
SELECT 'new-user-acquisition-v1', 'STREAK_REWARD', 'First 7-day streak completion reward', '250', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM campaign_rewards WHERE campaign_id = 'new-user-acquisition-v1' AND reward_type = 'STREAK_REWARD'
);
