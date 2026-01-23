import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import {
  methodNotAllowed,
  unauthorized,
  internalError,
  ErrorCode,
} from '../_shared/error-response.ts';
import { setUser, captureException } from '../_shared/sentry.ts';

const handler = async (req: Request): Promise<Response> => {
  // Only allow DELETE requests
  if (req.method !== 'DELETE') {
    return methodNotAllowed();
  }

  // Check authentication
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return unauthorized('Missing authorization header');
  }

  // Create Supabase client with user token
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: { Authorization: authHeader },
    },
  });

  // Verify user is authenticated
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return unauthorized('Unauthorized', ErrorCode.INVALID_AUTH);
  }

  // Set Sentry user context
  setUser(user.id);

  try {
    // Create admin client with service role key to delete auth user
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Delete profile first (this will cascade delete related data via FK constraints)
    // Profile deletion triggers cascading deletes on:
    // - discs (and their photos via cascade)
    // - recovery_events
    // - qr_codes
    // - shipping_addresses
    // - sticker_orders
    // etc.
    const { error: profileDeleteError } = await adminClient
      .from('profiles')
      .delete()
      .eq('id', user.id);

    if (profileDeleteError) {
      console.error('Profile deletion error:', profileDeleteError);
      captureException(profileDeleteError, {
        operation: 'delete-account',
        userId: user.id,
        step: 'delete-profile',
      });
      return internalError('Failed to delete account data', ErrorCode.DATABASE_ERROR);
    }

    // Delete the auth user
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(user.id);

    if (authDeleteError) {
      console.error('Auth user deletion error:', authDeleteError);
      captureException(authDeleteError, {
        operation: 'delete-account',
        userId: user.id,
        step: 'delete-auth-user',
      });
      return internalError('Failed to delete auth account', ErrorCode.DATABASE_ERROR);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Account deleted successfully',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Account deletion error:', error);
    captureException(error, {
      operation: 'delete-account',
      userId: user.id,
    });
    return internalError('Failed to delete account', ErrorCode.DATABASE_ERROR);
  }
};

Deno.serve(withSentry(handler));
