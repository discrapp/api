-- Add Prodigy Test Discs to User's Bag
-- Run this in Supabase Dashboard > SQL Editor

DO $$
DECLARE
  user_uuid UUID;
  user_email TEXT := 'benniemosher+test@gmail.com';
  disc_id UUID;
  d1_id UUID;
  d2_id UUID;
  h3_id UUID;
  f5_id UUID;
  m4_id UUID;
  m2_id UUID;
  a3_id UUID;
  pa3_id UUID;
BEGIN
  -- Find user by email
  SELECT id INTO user_uuid FROM auth.users WHERE email = user_email;

  IF user_uuid IS NULL THEN
    RAISE EXCEPTION 'User not found with email: %', user_email;
  END IF;

  RAISE NOTICE 'Found user: % with ID: %', user_email, user_uuid;

  -- D1 - Distance Driver (12/6/-1/3)
  INSERT INTO discs (owner_id, name, manufacturer, mold, plastic, weight, color, flight_numbers)
  VALUES (user_uuid, 'Pro D1', 'Prodigy', 'D1', '400G', 174, 'Light Blue', '{"speed": 12, "glide": 6, "turn": -1, "fade": 3}')
  RETURNING id INTO d1_id;

  -- D2 - Distance Driver (12/6/0/2)
  INSERT INTO discs (owner_id, name, manufacturer, mold, plastic, weight, color, flight_numbers)
  VALUES (user_uuid, 'Bomber D2', 'Prodigy', 'D2', '400', 175, 'Orange', '{"speed": 12, "glide": 6, "turn": 0, "fade": 2}')
  RETURNING id INTO d2_id;

  -- H3 V2 - Hybrid Driver (10/5/0/2)
  INSERT INTO discs (owner_id, name, manufacturer, mold, plastic, weight, color, flight_numbers)
  VALUES (user_uuid, 'Fairway H3', 'Prodigy', 'H3 V2', '400', 173, 'Purple', '{"speed": 10, "glide": 5, "turn": 0, "fade": 2}')
  RETURNING id INTO h3_id;

  -- F5 - Fairway Driver (7/5/-1/1)
  INSERT INTO discs (owner_id, name, manufacturer, mold, plastic, weight, color, flight_numbers)
  VALUES (user_uuid, 'Flippy F5', 'Prodigy', 'F5', '400', 170, 'Green', '{"speed": 7, "glide": 5, "turn": -1, "fade": 1}')
  RETURNING id INTO f5_id;

  -- M4 - Understable Midrange (5/5/-1/1)
  INSERT INTO discs (owner_id, name, manufacturer, mold, plastic, weight, color, flight_numbers)
  VALUES (user_uuid, 'Turnover M4', 'Prodigy', 'M4', '400', 177, 'Yellow', '{"speed": 5, "glide": 5, "turn": -1, "fade": 1}')
  RETURNING id INTO m4_id;

  -- M2 - Stable Midrange (5/4/0/2)
  INSERT INTO discs (owner_id, name, manufacturer, mold, plastic, weight, color, flight_numbers)
  VALUES (user_uuid, 'Workhorse M2', 'Prodigy', 'M2', '750', 180, 'Blue', '{"speed": 5, "glide": 4, "turn": 0, "fade": 2}')
  RETURNING id INTO m2_id;

  -- A3 - Approach (4/4/0/3)
  INSERT INTO discs (owner_id, name, manufacturer, mold, plastic, weight, color, flight_numbers)
  VALUES (user_uuid, 'Utility A3', 'Prodigy', 'A3', '400', 175, 'Red', '{"speed": 4, "glide": 4, "turn": 0, "fade": 3}')
  RETURNING id INTO a3_id;

  -- PA3 - Putter (3/4/0/1)
  INSERT INTO discs (owner_id, name, manufacturer, mold, plastic, weight, color, flight_numbers)
  VALUES (user_uuid, 'Putting PA3', 'Prodigy', 'PA3', '300', 174, 'White', '{"speed": 3, "glide": 4, "turn": 0, "fade": 1}')
  RETURNING id INTO pa3_id;

  RAISE NOTICE 'Created 8 Prodigy discs:';
  RAISE NOTICE '  D1: %', d1_id;
  RAISE NOTICE '  D2: %', d2_id;
  RAISE NOTICE '  H3 V2: %', h3_id;
  RAISE NOTICE '  F5: %', f5_id;
  RAISE NOTICE '  M4: %', m4_id;
  RAISE NOTICE '  M2: %', m2_id;
  RAISE NOTICE '  A3: %', a3_id;
  RAISE NOTICE '  PA3: %', pa3_id;
END $$;

-- Verify the discs were added
SELECT id, name, mold, manufacturer, plastic, weight, color,
       flight_numbers->>'speed' as speed,
       flight_numbers->>'glide' as glide,
       flight_numbers->>'turn' as turn,
       flight_numbers->>'fade' as fade
FROM discs
WHERE manufacturer = 'Prodigy'
ORDER BY (flight_numbers->>'speed')::int DESC;
