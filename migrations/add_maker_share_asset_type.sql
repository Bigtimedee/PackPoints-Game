-- Additive enum value for maker share PNGs (I MADE THIS SET).
-- Production schema sync is drizzle-kit push at boot; this file is the reference artifact.
ALTER TYPE content_asset_type ADD VALUE IF NOT EXISTS 'MAKER_SHARE_CARD';
