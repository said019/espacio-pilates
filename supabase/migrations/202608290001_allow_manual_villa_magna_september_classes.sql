-- Manual class generation in the admin must remain available. The automatic
-- startup generator independently skips Villa Magna Pilates during September
-- 2026, so the broad database trigger is no longer appropriate.
BEGIN;

DROP TRIGGER IF EXISTS trg_villa_magna_september_pilates_blackout ON classes;
DROP FUNCTION IF EXISTS enforce_villa_magna_september_pilates_blackout();

COMMIT;
