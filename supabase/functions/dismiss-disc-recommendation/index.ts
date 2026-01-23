import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser, captureException } from '../_shared/sentry.ts';

/**
 * Dismiss Disc Recommendation Function
 *
 * Authenticated endpoint for dismissing a disc recommendation so it won't
 * be suggested again in future recommendation requests.
 *
 * POST /dismiss-disc-recommendation
 * Body: {
 *   disc_catalog_id: string   // ID of the catalog disc to dismiss
 * }
 *
 * Returns:
 * - success: boolean
 * - dismissed: { id, disc_catalog_id, dismissed_at } (on success)
 * - message: string (if already dismissed)
 */

const handler = async (req: Request): Promise<Response> => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check authentication
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse request body
  let body: { disc_catalog_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate disc_catalog_id
  const { disc_catalog_id } = body;
  if (!disc_catalog_id) {
    return new Response(JSON.stringify({ error: 'disc_catalog_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create Supabase client with user's auth
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Set Sentry user context
  setUser(user.id);

  // Verify the disc exists in the catalog
  const { data: catalogDisc, error: catalogError } = await supabase
    .from('disc_catalog')
    .select('id')
    .eq('id', disc_catalog_id)
    .single();

  if (catalogError || !catalogDisc) {
    return new Response(JSON.stringify({ error: 'Disc not found in catalog' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Insert the dismissal record
  // RLS ensures user can only insert records for themselves
  const { data: dismissal, error: insertError } = await supabase
    .from('dismissed_disc_recommendations')
    .insert({
      user_id: user.id,
      disc_catalog_id,
    })
    .select('id, disc_catalog_id, dismissed_at')
    .single();

  if (insertError) {
    // Handle duplicate key constraint (disc already dismissed)
    if (insertError.code === '23505') {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Disc already dismissed',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    console.error('Failed to dismiss disc recommendation:', insertError);
    captureException(new Error('Failed to dismiss disc recommendation'), {
      operation: 'dismiss-disc-recommendation',
      userId: user.id,
      discCatalogId: disc_catalog_id,
      error: insertError,
    });
    return new Response(
      JSON.stringify({ error: 'Failed to dismiss recommendation', details: insertError.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      dismissed: {
        id: dismissal.id,
        disc_catalog_id: dismissal.disc_catalog_id,
        dismissed_at: dismissal.dismissed_at,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

Deno.serve(withSentry(handler));
