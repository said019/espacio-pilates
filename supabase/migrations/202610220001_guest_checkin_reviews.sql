-- Guests may attend without an account; reviews require a registered user.
CREATE OR REPLACE FUNCTION public.create_review_request()
RETURNS TRIGGER AS $$
DECLARE
    class_end TIMESTAMP WITH TIME ZONE;
BEGIN
    IF NEW.user_id IS NOT NULL AND NEW.status = 'checked_in'
       AND (OLD IS NULL OR OLD.status != 'checked_in') THEN
        SELECT (c.date + c.end_time)::timestamp with time zone
        INTO class_end FROM classes c WHERE c.id = NEW.class_id;
        INSERT INTO review_requests (
            booking_id, user_id, class_id, class_ended_at, send_at, status
        ) VALUES (
            NEW.id, NEW.user_id, NEW.class_id,
            class_end, class_end + INTERVAL '2 hours', 'pending'
        ) ON CONFLICT (booking_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
