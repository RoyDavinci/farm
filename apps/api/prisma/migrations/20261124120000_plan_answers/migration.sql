-- Answers from the step-by-step planner, kept so meals can be swapped with the same rules.
ALTER TABLE plans ADD COLUMN answers jsonb NOT NULL DEFAULT '{}'::jsonb;
