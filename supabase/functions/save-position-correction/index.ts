import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser, captureException } from '../_shared/sentry.ts';

/**
 * Save Position Correction Function
 *
 * Saves user corrections to AI-estimated tee and basket positions
 * for training data and future model improvement.
 *
 * POST /save-position-correction
 * Body: JSON with:
 *   - log_id: UUID of the shot_recommendation_logs entry
 *   - corrected_tee_position: { x: number, y: number }
 *   - corrected_basket_position: { x: number, y: number }
 *
 * Returns:
 * - success: boolean
 * - message: string
 */

interface PositionCorrection {
  log_id: string;
  corrected_tee_position: { x: number; y: number };
  corrected_basket_position: { x: number; y: number };
}

function isValidPosition(pos: unknown): pos is { x: number; y: number } {
  if (typeof pos !== 'object' || pos === null) return false;
  const p = pos as { x?: unknown; y?: unknown };
  return (
    typeof p.x === 'number' &&
    typeof p.y === 'number' &&
    p.x >= 0 &&
    p.x <= 100 &&
    p.y >= 0 &&
    p.y <= 100
  );
}

function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

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

  // Create Supabase client
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
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Set Sentry user context
  setUser(user.id);

  // Parse request body
  let body: PositionCorrection;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate required fields
  if (!body.log_id || !isValidUUID(body.log_id)) {
    return new Response(JSON.stringify({ error: 'Invalid or missing log_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!isValidPosition(body.corrected_tee_position)) {
    return new Response(
      JSON.stringify({ error: 'Invalid corrected_tee_position. Must be {x: 0-100, y: 0-100}' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  if (!isValidPosition(body.corrected_basket_position)) {
    return new Response(
      JSON.stringify({ error: 'Invalid corrected_basket_position. Must be {x: 0-100, y: 0-100}' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Create service role client for update (bypasses RLS for update)
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  try {
    // First verify the log belongs to this user
    const { data: existingLog, error: fetchError } = await supabaseAdmin
      .from('shot_recommendation_logs')
      .select('id, user_id')
      .eq('id', body.log_id)
      .single();

    if (fetchError || !existingLog) {
      return new Response(JSON.stringify({ error: 'Recommendation log not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verify ownership
    if (existingLog.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Not authorized to update this log' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Update the log with corrections
    const { error: updateError } = await supabaseAdmin
      .from('shot_recommendation_logs')
      .update({
        corrected_tee_position: body.corrected_tee_position,
        corrected_basket_position: body.corrected_basket_position,
        correction_submitted_at: new Date().toISOString(),
      })
      .eq('id', body.log_id);

    if (updateError) {
      console.error('Failed to save correction:', updateError);
      captureException(new Error('Failed to save position correction'), {
        operation: 'save-position-correction',
        userId: user.id,
        logId: body.log_id,
        error: updateError,
      });
      return new Response(JSON.stringify({ error: 'Failed to save correction' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Position correction saved successfully',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Correction error:', error);
    captureException(error, {
      operation: 'save-position-correction',
      userId: user.id,
      logId: body.log_id,
    });
    return new Response(JSON.stringify({ error: 'Failed to save correction' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

Deno.serve(withSentry(handler));
