-- Add logo field to restaurants (stores base64 data URL)
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS logo TEXT;
