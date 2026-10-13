-- Curriculum & learning portal: IELTS taxonomy on the existing content tree, mastery
-- tracking, live-session lifecycle, and nine new tables (curriculum assignment, skill
-- state, study plan, mock access, lecture recordings, vocabulary, grammar review).

-- ── Course sections: track/module/taxonomy tags ─────────────────────────────
ALTER TABLE "course_sections"
  ADD COLUMN "track" TEXT NOT NULL DEFAULT 'BOTH',
  ADD COLUMN "module" TEXT,
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'UNIT',
  ADD COLUMN "area" TEXT,
  ADD COLUMN "skill_key" TEXT;

ALTER TABLE "course_sections"
  ADD CONSTRAINT "course_sections_track_valid" CHECK ("track" IN ('ACADEMIC', 'GENERAL', 'BOTH')),
  ADD CONSTRAINT "course_sections_module_valid" CHECK ("module" IS NULL OR "module" IN ('LISTENING', 'READING', 'WRITING', 'SPEAKING', 'GENERAL')),
  ADD CONSTRAINT "course_sections_kind_valid" CHECK ("kind" IN ('MODULE', 'AREA', 'UNIT'));

CREATE INDEX "course_sections_module_track_idx" ON "course_sections"("module", "track");

-- ── Content items: activity taxonomy, difficulty, band range, timing, mastery rule ──
ALTER TABLE "content_items"
  ADD COLUMN "track" TEXT NOT NULL DEFAULT 'BOTH',
  ADD COLUMN "module" TEXT,
  ADD COLUMN "skill_key" TEXT,
  ADD COLUMN "test_part" TEXT,
  ADD COLUMN "activity_kind" TEXT NOT NULL DEFAULT 'LESSON',
  ADD COLUMN "difficulty" TEXT,
  ADD COLUMN "band_min" DECIMAL(3,1),
  ADD COLUMN "band_max" DECIMAL(3,1),
  ADD COLUMN "is_timed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "teacher_assignable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "recommendable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "mastery_percent" INTEGER,
  ADD COLUMN "prerequisite_skill_keys" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "content_items"
  ADD CONSTRAINT "content_items_track_valid" CHECK ("track" IN ('ACADEMIC', 'GENERAL', 'BOTH')),
  ADD CONSTRAINT "content_items_module_valid" CHECK ("module" IS NULL OR "module" IN ('LISTENING', 'READING', 'WRITING', 'SPEAKING', 'GENERAL')),
  ADD CONSTRAINT "content_items_activity_kind_valid" CHECK ("activity_kind" IN ('LESSON', 'WORKED_EXAMPLE', 'GUIDED_EXERCISE', 'PRACTICE', 'TIMED_PRACTICE', 'MASTERY_CHECK', 'PROMPT', 'REVISION')),
  ADD CONSTRAINT "content_items_difficulty_valid" CHECK ("difficulty" IS NULL OR "difficulty" IN ('FOUNDATION', 'EASY', 'MEDIUM', 'HARD')),
  ADD CONSTRAINT "content_items_band_min_valid" CHECK ("band_min" IS NULL OR ("band_min" BETWEEN 0 AND 9 AND "band_min" * 2 = floor("band_min" * 2))),
  ADD CONSTRAINT "content_items_band_max_valid" CHECK ("band_max" IS NULL OR ("band_max" BETWEEN 0 AND 9 AND "band_max" * 2 = floor("band_max" * 2))),
  ADD CONSTRAINT "content_items_band_range_valid" CHECK ("band_min" IS NULL OR "band_max" IS NULL OR "band_min" <= "band_max"),
  ADD CONSTRAINT "content_items_mastery_percent_valid" CHECK ("mastery_percent" IS NULL OR "mastery_percent" BETWEEN 1 AND 100);

CREATE INDEX "content_items_module_track_skill_key_idx" ON "content_items"("module", "track", "skill_key");

-- ── Questions: IELTS-facing taxonomy, separate from the grader-discriminator questionType ──
-- question_type (existing column) stays the GRADER key (MCQ_SINGLE/MCQ_MULTI/TFNG/YNNG/MATCHING/COMPLETION).
-- ielts_question_type is the IELTS-facing label (Matching Headings, Form Completion, …) used for
-- filtering, practice generation and insights; several map onto the same grader.
ALTER TABLE "questions"
  ADD COLUMN "skill_key" TEXT,
  ADD COLUMN "ielts_question_type" TEXT,
  ADD COLUMN "module" TEXT,
  ADD COLUMN "track" TEXT NOT NULL DEFAULT 'BOTH',
  ADD COLUMN "test_part" TEXT,
  ADD COLUMN "difficulty" TEXT,
  ADD COLUMN "band_min" DECIMAL(3,1),
  ADD COLUMN "band_max" DECIMAL(3,1),
  ADD COLUMN "expected_seconds" INTEGER,
  ADD COLUMN "source_label" TEXT NOT NULL DEFAULT 'ORIGINAL',
  ADD COLUMN "source_note" TEXT;

ALTER TABLE "questions"
  ADD CONSTRAINT "questions_module_valid" CHECK ("module" IS NULL OR "module" IN ('LISTENING', 'READING', 'WRITING', 'SPEAKING', 'GENERAL')),
  ADD CONSTRAINT "questions_track_valid" CHECK ("track" IN ('ACADEMIC', 'GENERAL', 'BOTH')),
  ADD CONSTRAINT "questions_difficulty_valid" CHECK ("difficulty" IS NULL OR "difficulty" IN ('FOUNDATION', 'EASY', 'MEDIUM', 'HARD')),
  ADD CONSTRAINT "questions_ielts_question_type_valid" CHECK ("ielts_question_type" IS NULL OR "ielts_question_type" IN (
    'FORM_COMPLETION', 'NOTE_COMPLETION', 'TABLE_COMPLETION', 'FLOW_CHART_COMPLETION', 'SUMMARY_COMPLETION', 'SENTENCE_COMPLETION',
    'MULTIPLE_CHOICE_SINGLE', 'MULTIPLE_CHOICE_MULTI', 'MATCHING', 'MATCHING_INFORMATION', 'MATCHING_HEADINGS', 'MATCHING_FEATURES',
    'MATCHING_SENTENCE_ENDINGS', 'MAP_PLAN_DIAGRAM_LABELLING', 'DIAGRAM_LABELLING', 'SHORT_ANSWER', 'TRUE_FALSE_NOT_GIVEN', 'YES_NO_NOT_GIVEN'
  )),
  ADD CONSTRAINT "questions_band_min_valid" CHECK ("band_min" IS NULL OR ("band_min" BETWEEN 0 AND 9 AND "band_min" * 2 = floor("band_min" * 2))),
  ADD CONSTRAINT "questions_band_max_valid" CHECK ("band_max" IS NULL OR ("band_max" BETWEEN 0 AND 9 AND "band_max" * 2 = floor("band_max" * 2))),
  ADD CONSTRAINT "questions_source_label_valid" CHECK ("source_label" IN ('ORIGINAL', 'OFFICIAL_LICENSED'));

CREATE INDEX "questions_module_ielts_question_type_difficulty_idx" ON "questions"("module", "ielts_question_type", "difficulty");

-- ── Content progress: mastery is evidence-based and distinct from completion ──
ALTER TABLE "content_progress"
  ADD COLUMN "mastered_at" TIMESTAMP(3),
  ADD COLUMN "needs_review_at" TIMESTAMP(3),
  ADD COLUMN "review_due_at" TIMESTAMP(3),
  ADD COLUMN "best_percent" DECIMAL(5,2),
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "content_progress"
  ADD CONSTRAINT "content_progress_best_percent_valid" CHECK ("best_percent" IS NULL OR "best_percent" BETWEEN 0 AND 100);

-- ── Student track: normalise to the two values the app already writes, then enforce it ──
UPDATE "student_profiles" SET "academic_or_general" = upper("academic_or_general") WHERE "academic_or_general" IS NOT NULL;
UPDATE "student_profiles" SET "academic_or_general" = NULL WHERE "academic_or_general" NOT IN ('ACADEMIC', 'GENERAL');

ALTER TABLE "student_profiles"
  ADD CONSTRAINT "student_profiles_academic_or_general_valid" CHECK ("academic_or_general" IS NULL OR "academic_or_general" IN ('ACADEMIC', 'GENERAL'));

-- ── Live sessions: an explicit, application-recorded lifecycle (never inferred from the clock alone) ──
ALTER TABLE "live_sessions"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "instructions" TEXT,
  ADD COLUMN "module" TEXT,
  ADD COLUMN "curriculum_section_id" UUID,
  ADD COLUMN "started_at" TIMESTAMP(3),
  ADD COLUMN "completed_at" TIMESTAMP(3),
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "cancel_reason" TEXT,
  ADD COLUMN "rescheduled_from_starts_at" TIMESTAMP(3),
  ADD COLUMN "attendance_finalized_at" TIMESTAMP(3),
  ADD COLUMN "attendance_finalized_by" UUID;

-- Backfill: a session whose end time has already passed is COMPLETED (best evidence available
-- pre-migration); everything else stays SCHEDULED. This is explicitly a backfill, not a claim
-- that the class definitely ran — see the application-recorded-status note in live.service.ts.
UPDATE "live_sessions" SET "status" = 'COMPLETED', "completed_at" = "ends_at" WHERE "ends_at" < now();

ALTER TABLE "live_sessions"
  ADD CONSTRAINT "live_sessions_status_valid" CHECK ("status" IN ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED')),
  ADD CONSTRAINT "live_sessions_module_valid" CHECK ("module" IS NULL OR "module" IN ('LISTENING', 'READING', 'WRITING', 'SPEAKING', 'GENERAL')),
  ADD CONSTRAINT "live_sessions_curriculum_section_id_fkey" FOREIGN KEY ("curriculum_section_id") REFERENCES "course_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "live_sessions_batch_id_status_idx" ON "live_sessions"("batch_id", "status");

-- ── Attendance: a note field for the §43 "excused" / correction workflow ──
ALTER TABLE "attendance"
  ADD COLUMN "note" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now();


-- ── Curriculum assignments: a teacher assigns an existing curriculum item to a batch or named
-- students. Distinct from "assignments" (a writing/speaking task bound 1:1 to a content item) —
-- this is the §20 teacher delivery layer over the master library. ──
CREATE TABLE "curriculum_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "content_item_id" UUID NOT NULL,
  "batch_id" UUID,
  "student_id" UUID,
  "assigned_by" UUID NOT NULL,
  "requirement" TEXT NOT NULL DEFAULT 'REQUIRED',
  "classification" TEXT NOT NULL DEFAULT 'GENERAL',
  "session_id" UUID,
  "due_at" TIMESTAMP(3),
  "instructions" TEXT,
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "curriculum_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "curriculum_assignments_target_chk" CHECK ("batch_id" IS NOT NULL OR "student_id" IS NOT NULL),
  CONSTRAINT "curriculum_assignments_requirement_valid" CHECK ("requirement" IN ('REQUIRED', 'RECOMMENDED')),
  CONSTRAINT "curriculum_assignments_classification_valid" CHECK ("classification" IN ('PRE_CLASS', 'POST_CLASS', 'HOMEWORK', 'GENERAL')),
  CONSTRAINT "curriculum_assignments_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "curriculum_assignments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "curriculum_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "curriculum_assignments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "live_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "curriculum_assignments_batch_id_idx" ON "curriculum_assignments"("batch_id");
CREATE INDEX "curriculum_assignments_student_id_idx" ON "curriculum_assignments"("student_id");
CREATE INDEX "curriculum_assignments_content_item_id_idx" ON "curriculum_assignments"("content_item_id");
ALTER TABLE "curriculum_assignments" ENABLE ROW LEVEL SECURITY;

-- ── Per-skill mastery/weakness state, maintained by the adaptive engine from real evidence ──
CREATE TABLE "student_skill_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "skill_key" TEXT NOT NULL,
  "module" TEXT,
  "track" TEXT NOT NULL DEFAULT 'BOTH',
  "state" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "accuracy_percent" DECIMAL(5,2),
  "sample_size" INTEGER NOT NULL DEFAULT 0,
  "last_evidence_at" TIMESTAMP(3),
  "review_due_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "student_skill_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "student_skill_states_state_valid" CHECK ("state" IN ('UNKNOWN', 'WEAK', 'DEVELOPING', 'STRONG', 'MASTERED', 'NEEDS_REVIEW')),
  CONSTRAINT "student_skill_states_module_valid" CHECK ("module" IS NULL OR "module" IN ('LISTENING', 'READING', 'WRITING', 'SPEAKING', 'GENERAL')),
  CONSTRAINT "student_skill_states_accuracy_percent_valid" CHECK ("accuracy_percent" IS NULL OR "accuracy_percent" BETWEEN 0 AND 100),
  CONSTRAINT "student_skill_states_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "student_skill_states_student_id_skill_key_key" ON "student_skill_states"("student_id", "skill_key");
ALTER TABLE "student_skill_states" ENABLE ROW LEVEL SECURITY;

-- ── Study plan: when a student plans to work on something, distinct from the curriculum map ──
CREATE TABLE "study_plan_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "content_item_id" UUID,
  "planned_for" DATE NOT NULL,
  "estimated_minutes" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "source" TEXT NOT NULL DEFAULT 'STUDENT',
  "notes" TEXT,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "study_plan_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "study_plan_items_status_valid" CHECK ("status" IN ('PLANNED', 'DONE', 'SKIPPED')),
  CONSTRAINT "study_plan_items_source_valid" CHECK ("source" IN ('STUDENT', 'TEACHER', 'SYSTEM')),
  CONSTRAINT "study_plan_items_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "study_plan_items_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "study_plan_items_student_id_planned_for_idx" ON "study_plan_items"("student_id", "planned_for");
ALTER TABLE "study_plan_items" ENABLE ROW LEVEL SECURITY;

-- ── Mock-test access requests: a student's individual request for a controlled mock ──
CREATE TABLE "mock_access_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "assessment_id" UUID NOT NULL,
  "batch_id" UUID,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewed_by" UUID,
  "decision_note" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "available_from" TIMESTAMP(3),
  "available_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "mock_access_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mock_access_requests_status_valid" CHECK ("status" IN ('PENDING', 'APPROVED', 'DECLINED', 'EXPIRED')),
  CONSTRAINT "mock_access_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mock_access_requests_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mock_access_requests_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- Only one open (pending) request per student per mock at a time; past decisions are kept as history.
CREATE UNIQUE INDEX "mock_access_requests_one_pending_per_student" ON "mock_access_requests"("student_id", "assessment_id") WHERE "status" = 'PENDING';
CREATE INDEX "mock_access_requests_assessment_id_status_idx" ON "mock_access_requests"("assessment_id", "status");
ALTER TABLE "mock_access_requests" ENABLE ROW LEVEL SECURITY;

-- ── Mock-test batch activation: a teacher opens a mock for an entire batch at once ──
CREATE TABLE "mock_activations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" UUID NOT NULL,
  "assessment_id" UUID NOT NULL,
  "available_from" TIMESTAMP(3) NOT NULL,
  "available_until" TIMESTAMP(3),
  "instructions" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "activated_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "mock_activations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mock_activations_status_valid" CHECK ("status" IN ('ACTIVE', 'CANCELLED')),
  CONSTRAINT "mock_activations_window_valid" CHECK ("available_until" IS NULL OR "available_until" > "available_from"),
  CONSTRAINT "mock_activations_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mock_activations_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mock_activations_batch_id_assessment_id_key" ON "mock_activations"("batch_id", "assessment_id");
ALTER TABLE "mock_activations" ENABLE ROW LEVEL SECURITY;

-- ── Lecture recordings: Google Drive links submitted by teachers, linked to a class and batch ──
CREATE TABLE "lecture_recordings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "session_id" UUID,
  "batch_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "module" TEXT,
  "drive_url" TEXT NOT NULL,
  "drive_file_id" TEXT,
  "description" TEXT,
  "chapters" JSONB,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "submitted_by" UUID,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMP(3),
  "review_note" TEXT,
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lecture_recordings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lecture_recordings_status_valid" CHECK ("status" IN ('SUBMITTED', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED')),
  CONSTRAINT "lecture_recordings_module_valid" CHECK ("module" IS NULL OR "module" IN ('LISTENING', 'READING', 'WRITING', 'SPEAKING', 'GENERAL')),
  CONSTRAINT "lecture_recordings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "live_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "lecture_recordings_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "lecture_recordings_batch_id_idx" ON "lecture_recordings"("batch_id");
CREATE INDEX "lecture_recordings_session_id_idx" ON "lecture_recordings"("session_id");
ALTER TABLE "lecture_recordings" ENABLE ROW LEVEL SECURITY;

-- Seed one row per existing live_sessions.recording_url so no history is lost. The column stays
-- in place (student schedule reads it directly); this gives those same recordings a proper
-- archive entry too. Attribution is unknown for this backfill, so submitted_by is left null.
INSERT INTO "lecture_recordings" ("id", "session_id", "batch_id", "title", "drive_url", "status", "submitted_at", "published_at", "updated_at")
SELECT gen_random_uuid(), ls."id", ls."batch_id", ls."topic", ls."recording_url", 'PUBLISHED', ls."ends_at", ls."ends_at", now()
FROM "live_sessions" ls
WHERE ls."recording_url" IS NOT NULL;

-- ── Per-student "opened / reviewed" marks on a recording — never a claim of watch time ──
CREATE TABLE "lecture_recording_views" (
  "recording_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "reviewed_at" TIMESTAMP(3),
  CONSTRAINT "lecture_recording_views_pkey" PRIMARY KEY ("recording_id", "student_id"),
  CONSTRAINT "lecture_recording_views_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "lecture_recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lecture_recording_views_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "lecture_recording_views" ENABLE ROW LEVEL SECURITY;

-- ── Personal vocabulary bank ──
CREATE TABLE "vocabulary_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "term" TEXT NOT NULL,
  "definition" TEXT,
  "example" TEXT,
  "collocation" TEXT,
  "source_type" TEXT,
  "source_id" UUID,
  "student_example" TEXT,
  "review_status" TEXT NOT NULL DEFAULT 'NEW',
  "next_review_at" TIMESTAMP(3),
  "review_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vocabulary_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vocabulary_entries_review_status_valid" CHECK ("review_status" IN ('NEW', 'LEARNING', 'KNOWN')),
  CONSTRAINT "vocabulary_entries_source_type_valid" CHECK ("source_type" IS NULL OR "source_type" IN ('READING', 'LESSON', 'WRITING_FEEDBACK', 'SPEAKING_FEEDBACK', 'MANUAL')),
  CONSTRAINT "vocabulary_entries_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "vocabulary_entries_student_id_term_key" ON "vocabulary_entries"("student_id", lower("term"));
CREATE INDEX "vocabulary_entries_student_id_review_status_idx" ON "vocabulary_entries"("student_id", "review_status");
ALTER TABLE "vocabulary_entries" ENABLE ROW LEVEL SECURITY;

-- ── Grammar issues: written only from teacher-reviewed submissions, never auto-detected ──
CREATE TABLE "grammar_issues" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "category" TEXT NOT NULL,
  "submission_id" UUID,
  "excerpt" TEXT,
  "note" TEXT,
  "recorded_by" UUID NOT NULL,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "grammar_issues_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "grammar_issues_category_valid" CHECK ("category" IN (
    'ARTICLES', 'SUBJECT_VERB_AGREEMENT', 'VERB_TENSE', 'SENTENCE_FRAGMENTS', 'RUN_ON_SENTENCES',
    'PREPOSITIONS', 'COUNTABLE_UNCOUNTABLE_NOUNS', 'WORD_FORMS', 'PUNCTUATION', 'SENTENCE_STRUCTURE'
  )),
  CONSTRAINT "grammar_issues_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "grammar_issues_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "grammar_issues_student_id_category_idx" ON "grammar_issues"("student_id", "category");
ALTER TABLE "grammar_issues" ENABLE ROW LEVEL SECURITY;

-- ── Fix pre-existing RLS drift: these six tables were created in 20261002000000 without RLS ──
ALTER TABLE "teacher_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_educations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_experiences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_references" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teacher_documents" ENABLE ROW LEVEL SECURITY;
