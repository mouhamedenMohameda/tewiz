-- Remove placeholder map labels from historical rows.
-- These strings are UI helpers and should never be treated as real addresses.

-- Main rides history / current rides
UPDATE rides
   SET pickup_label = NULL
 WHERE pickup_label IS NOT NULL
   AND LOWER(BTRIM(pickup_label)) IN (
     'point sur la carte',
     'ma position',
     'pin on map',
     'my location',
     'نقطة على الخريطة',
     'موقعي'
   );

UPDATE rides
   SET dropoff_label = NULL
 WHERE dropoff_label IS NOT NULL
   AND LOWER(BTRIM(dropoff_label)) IN (
     'point sur la carte',
     'ma position',
     'pin on map',
     'my location',
     'نقطة على الخريطة',
     'موقعي'
   );

-- Recurring rides templates
UPDATE recurring_rides
   SET pickup_label = NULL
 WHERE pickup_label IS NOT NULL
   AND LOWER(BTRIM(pickup_label)) IN (
     'point sur la carte',
     'ma position',
     'pin on map',
     'my location',
     'نقطة على الخريطة',
     'موقعي'
   );

UPDATE recurring_rides
   SET dropoff_label = NULL
 WHERE dropoff_label IS NOT NULL
   AND LOWER(BTRIM(dropoff_label)) IN (
     'point sur la carte',
     'ma position',
     'pin on map',
     'my location',
     'نقطة على الخريطة',
     'موقعي'
   );

-- Voice-request moderation queue/history
UPDATE voice_ride_requests
   SET pickup_label = NULL
 WHERE pickup_label IS NOT NULL
   AND LOWER(BTRIM(pickup_label)) IN (
     'point sur la carte',
     'ma position',
     'pin on map',
     'my location',
     'نقطة على الخريطة',
     'موقعي'
   );

UPDATE voice_ride_requests
   SET dropoff_label = NULL
 WHERE dropoff_label IS NOT NULL
   AND LOWER(BTRIM(dropoff_label)) IN (
     'point sur la carte',
     'ma position',
     'pin on map',
     'my location',
     'نقطة على الخريطة',
     'موقعي'
   );
