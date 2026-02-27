-- Add Notion integration fields to publishing_queue table
-- Run this on Railway: railway run npx drizzle-kit push

ALTER TABLE publishing_queue
  ADD COLUMN IF NOT EXISTS notion_page_id TEXT,
  ADD COLUMN IF NOT EXISTS notion_sync_status VARCHAR(20) DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS notion_synced_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS notion_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS posting_status VARCHAR(20) DEFAULT 'MANUAL_QUEUE',
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMP,
  ADD COLUMN IF NOT EXISTS platform_post_id TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Create index for Notion sync queries
CREATE INDEX IF NOT EXISTS idx_publishing_queue_notion_sync
  ON publishing_queue(notion_sync_status, notion_page_id);

CREATE INDEX IF NOT EXISTS idx_publishing_queue_posting_status
  ON publishing_queue(posting_status, scheduled_for);

-- Add comments
COMMENT ON COLUMN publishing_queue.notion_page_id IS 'Notion page ID after sync';
COMMENT ON COLUMN publishing_queue.notion_sync_status IS 'PENDING, SYNCED, ERROR';
COMMENT ON COLUMN publishing_queue.posting_status IS 'MANUAL_QUEUE, POSTED, FAILED';
COMMENT ON COLUMN publishing_queue.metadata IS 'JSON metadata: caption, hashtags, videoUrl, etc.';
