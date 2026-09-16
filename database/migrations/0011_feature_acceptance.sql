SET LOCAL ROLE app_owner;
ALTER TABLE app.features ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT '';
ALTER TABLE app.features ADD CONSTRAINT features_acceptance_check CHECK (length(acceptance_criteria) <= 50000);
