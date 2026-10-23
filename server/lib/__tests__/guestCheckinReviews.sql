\set ON_ERROR_STOP on
BEGIN;
\ir ../../../supabase/migrations/202610220001_guest_checkin_reviews.sql
-- Temporary fixtures shadow application tables; no real attendance is touched.
CREATE TEMP TABLE classes (id int, date date, end_time time);
CREATE TEMP TABLE bookings (id int, user_id int, class_id int, status text);
CREATE TEMP TABLE review_requests (booking_id int UNIQUE, user_id int NOT NULL, class_id int, class_ended_at timestamptz, send_at timestamptz, status text);
CREATE TRIGGER review_test AFTER INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION public.create_review_request();
INSERT INTO classes VALUES (1, '2026-10-22', '20:25');
INSERT INTO bookings VALUES (1, NULL, 1, 'confirmed'), (2, 123, 1, 'confirmed');
UPDATE bookings SET status='checked_in';
DO $$ BEGIN
  IF (SELECT count(*) FROM bookings WHERE status='checked_in') <> 2 THEN RAISE EXCEPTION 'Check-in failed'; END IF;
  IF (SELECT count(*) FROM review_requests) <> 1 THEN RAISE EXCEPTION 'Expected only registered review'; END IF;
  IF NOT EXISTS (SELECT 1 FROM review_requests WHERE user_id=123 AND booking_id=2) THEN RAISE EXCEPTION 'Registered review missing'; END IF;
END $$;
UPDATE bookings SET status='confirmed';
UPDATE bookings SET status='checked_in';
INSERT INTO bookings VALUES (3, NULL, 1, 'checked_in');
DO $$ BEGIN
  IF (SELECT count(*) FROM review_requests) <> 1 THEN RAISE EXCEPTION 'Duplicate or guest review'; END IF;
  IF (SELECT count(*) FROM bookings WHERE status='checked_in') <> 3 THEN RAISE EXCEPTION 'Guest insert failed'; END IF;
END $$;
ROLLBACK;
