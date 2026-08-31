-- Publish the exact Google Maps location supplied for the Pozos branch.
-- This migration is safe to replay at startup: it only fills missing values.
BEGIN;

ALTER TABLE branches ADD COLUMN IF NOT EXISTS maps_url TEXT;

UPDATE branches
   SET address = COALESCE(NULLIF(BTRIM(address), ''), 'Pozos, San Luis Potosí, S.L.P.'),
       maps_url = COALESCE(
         NULLIF(BTRIM(maps_url), ''),
         'https://maps.google.com/?q=22.096529,-100.869797'
       ),
       updated_at = NOW()
 WHERE code = 'pozos';

COMMIT;
