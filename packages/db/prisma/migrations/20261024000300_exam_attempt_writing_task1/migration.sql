-- Add writing Task 1 response to exam attempts (Feature 8: dual writing tasks in simulator)
ALTER TABLE exam_attempts
  ADD COLUMN writing_task1_response_id UUID REFERENCES writing_responses(id);
