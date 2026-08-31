-- Publish the exact Google Maps location supplied for the Pozos branch.
-- This migration is safe to replay at startup: it only fills missing values.
BEGIN;

ALTER TABLE branches ADD COLUMN IF NOT EXISTS maps_url TEXT;

UPDATE branches
   SET address = COALESCE(
         NULLIF(BTRIM(address), ''),
         'Camino a los Pozos, Boulevard de Pozos 302-E, 78420 Laguna de Santa Rita, S.L.P.'
       ),
       maps_url = COALESCE(
         NULLIF(BTRIM(maps_url), ''),
         'https://www.google.com/maps?q=Tu+Espacio+Pilates+Pozos,+Camino+a+los+Pozos,+Boulevard+de+Pozos+302-E,+78420+Laguna+de+Santa+Rita,+S.L.P.&ftid=0x842aa5ec38bd6d83:0x83d5a2cdd0d0d0da'
       ),
       updated_at = NOW()
 WHERE code = 'pozos';

COMMIT;
