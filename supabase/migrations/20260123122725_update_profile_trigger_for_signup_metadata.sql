-- Update handle_new_user function to copy all profile fields from user metadata
-- This allows passing username, full_name, phone_number, throwing_hand, and
-- preferred_throw_style during signup via options.data

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    username,
    full_name,
    phone_number,
    throwing_hand,
    preferred_throw_style,
    created_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || SUBSTRING(NEW.id::text, 1, 8)),
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'phone_number',
    COALESCE(NEW.raw_user_meta_data->>'throwing_hand', 'right'),
    COALESCE(NEW.raw_user_meta_data->>'preferred_throw_style', 'backhand'),
    NEW.created_at
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.handle_new_user() IS 'Automatically creates a profile record when a new user signs up, copying profile fields from metadata';
