-- Creator/Influencer partnership application system
CREATE TABLE IF NOT EXISTS creator_applications (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  social_handle VARCHAR(255) NOT NULL,
  platform VARCHAR(100) NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'youtube', 'twitter', 'other')),
  follower_count INTEGER,
  content_description TEXT,
  why_packpts TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'waitlisted')),
  tier VARCHAR(50) CHECK (tier IN ('micro', 'partner', 'ambassador')),
  referral_code VARCHAR(50) UNIQUE,
  notes TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_applications_status ON creator_applications(status);
CREATE INDEX IF NOT EXISTS idx_creator_applications_email ON creator_applications(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_applications_referral_code ON creator_applications(referral_code) WHERE referral_code IS NOT NULL;
