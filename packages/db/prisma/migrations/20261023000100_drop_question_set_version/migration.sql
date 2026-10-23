-- QuestionSet.version is a cosmetic, unused counter: no FK, no unique constraint, never read in a
-- where-filter anywhere, only ever incremented by cloneSet() on a brand-new disconnected row. Real
-- multi-version lineage for question content lives in QuestionVersion (per-question), which is
-- untouched by this migration.
ALTER TABLE "question_sets" DROP COLUMN "version";
