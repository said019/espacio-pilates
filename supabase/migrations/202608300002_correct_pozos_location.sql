-- Replace the preliminary coordinate pin with the confirmed Pozos studio
-- listing supplied by the owner. The WHERE clause preserves later edits.
BEGIN;

ALTER TABLE branches ADD COLUMN IF NOT EXISTS maps_url TEXT;

UPDATE branches
   SET address = 'Camino a los Pozos, Boulevard de Pozos 302-E, 78420 Laguna de Santa Rita, S.L.P.',
       maps_url = 'https://www.google.com/maps?q=Tu+Espacio+Pilates+Pozos,+Camino+a+los+Pozos,+Boulevard+de+Pozos+302-E,+78420+Laguna+de+Santa+Rita,+S.L.P.&ftid=0x842aa5ec38bd6d83:0x83d5a2cdd0d0d0da',
       updated_at = NOW()
 WHERE code = 'pozos'
   AND (
     maps_url IS NULL
     OR BTRIM(maps_url) = ''
     OR maps_url = 'https://maps.google.com/?q=22.096529,-100.869797'
   );

COMMIT;
