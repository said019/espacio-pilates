-- Lifetime entitlement shared across branches. The claim survives cancellation
-- and booking deletion; changing the same booking's date does not spend it twice.
CREATE TABLE IF NOT EXISTS free_class_claims (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT NOW()
);

INSERT INTO free_class_claims (user_id, booking_id)
SELECT DISTINCT ON (b.user_id) b.user_id, b.id
FROM bookings b JOIN classes c ON c.id=b.class_id
WHERE b.user_id IS NOT NULL AND b.membership_id IS NULL AND c.is_walk_in = true
  AND c.walk_in_requires_inscription = false
ORDER BY b.user_id, b.created_at, b.id
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION enforce_one_free_class() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE claimed_booking uuid;
BEGIN
  IF NEW.user_id IS NULL OR NEW.membership_id IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM classes c WHERE c.id=NEW.class_id
      AND c.is_walk_in=true AND c.walk_in_requires_inscription=false
  ) THEN RETURN NEW; END IF;

  -- Linking a pre-existing guest visit must not prevent account registration.
  -- Record the benefit as used, without creating or deleting any reservation.
  IF TG_OP='UPDATE' AND OLD.user_id IS NULL AND OLD.class_id=NEW.class_id THEN
    INSERT INTO free_class_claims (user_id,booking_id) VALUES (NEW.user_id,NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
  END IF;

  -- Also cover historical reservations in classes subsequently marked free.
  IF EXISTS (
    SELECT 1 FROM bookings b JOIN classes c ON c.id=b.class_id
    WHERE b.user_id=NEW.user_id AND b.id<>NEW.id AND b.membership_id IS NULL
      AND c.is_walk_in=true AND c.walk_in_requires_inscription=false
  ) THEN
    RAISE EXCEPTION USING ERRCODE='PFC01', MESSAGE='Ya utilizaste tu clase gratis. Para volver a tomar clase, compra una visita o adquiere una membresía. ¡Te esperamos!';
  END IF;

  -- The unique user key serializes even simultaneous reservations in different
  -- classes/branches. A rolled-back booking rolls back its claim as well.
  INSERT INTO free_class_claims (user_id,booking_id) VALUES (NEW.user_id,NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT booking_id INTO claimed_booking FROM free_class_claims WHERE user_id=NEW.user_id;
  IF claimed_booking<>NEW.id THEN
    RAISE EXCEPTION USING ERRCODE='PFC01', MESSAGE='Ya utilizaste tu clase gratis. Para volver a tomar clase, compra una visita o adquiere una membresía. ¡Te esperamos!';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_one_free_class ON bookings;
CREATE TRIGGER bookings_one_free_class BEFORE INSERT OR UPDATE OF user_id,class_id ON bookings
FOR EACH ROW EXECUTE FUNCTION enforce_one_free_class();
