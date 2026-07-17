-- Making Layer: add maker identity fields to game_sets
-- Prompt 1 of MAKING_LAYER_PROMPTS.md

ALTER TABLE public.game_sets
  ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS maker_note TEXT,
  ADD COLUMN IF NOT EXISTS is_user_created BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_game_sets_user_created ON public.game_sets (is_user_created);
