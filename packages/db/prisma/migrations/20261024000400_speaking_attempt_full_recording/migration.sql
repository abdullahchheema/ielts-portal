-- Add full-recording fields to speaking_attempts (Feature 9: continuous recording in simulator)
ALTER TABLE speaking_attempts
  ADD COLUMN audio_storage_key TEXT UNIQUE,
  ADD COLUMN audio_mime        TEXT,
  ADD COLUMN audio_size_bytes  BIGINT,
  ADD COLUMN audio_duration_sec NUMERIC(8, 2);

-- Add per-question timestamp markers to speaking_responses (for transcript splitting)
ALTER TABLE speaking_responses
  ADD COLUMN start_sec NUMERIC(8, 2),
  ADD COLUMN end_sec   NUMERIC(8, 2);
