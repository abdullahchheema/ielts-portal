-- Phase 3.2: four-skill manual mock composition
-- Add optional pinned Writing / Speaking question FKs to mock_exams so admins can pin
-- specific prompts rather than relying on the per-attempt random pick.
-- Add mock_exam_id to exam_attempts so afterReading() knows which pinned questions to use.

ALTER TABLE mock_exams
  ADD COLUMN writing_task1_question_id UUID REFERENCES questions(id),
  ADD COLUMN writing_task2_question_id UUID REFERENCES questions(id),
  ADD COLUMN speaking_part1_question_id UUID REFERENCES questions(id),
  ADD COLUMN speaking_part2_question_id UUID REFERENCES questions(id),
  ADD COLUMN speaking_part3_question_id UUID REFERENCES questions(id);

ALTER TABLE exam_attempts
  ADD COLUMN mock_exam_id UUID REFERENCES mock_exams(id);

CREATE INDEX exam_attempts_mock_exam_idx ON exam_attempts(mock_exam_id) WHERE mock_exam_id IS NOT NULL;
