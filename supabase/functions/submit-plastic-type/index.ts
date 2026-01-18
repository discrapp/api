import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser, captureException } from '../_shared/sentry.ts';

/**
 * Submit Plastic Type Function
 *
 * Authenticated endpoint for users to submit new plastic types.
 * Submitted plastics have 'pending' status until approved by an admin.
 *
 * POST /submit-plastic-type
 *
 * Request Body:
 * - manufacturer: Manufacturer name (required)
 * - plastic_name: Plastic type name (required)
 *
 * Returns:
 * - The created plastic type with pending status
 * - 409 if the plastic type already exists
 */

interface SubmitPlasticTypeRequest {
  manufacturer: string;
  plastic_name: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get auth header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Authorization required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create Supabase client
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  // Authenticate user
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

  setUser(user.id);

  // Parse request body
  let body: SubmitPlasticTypeRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate required fields
  const manufacturer = body.manufacturer?.trim();
  const plasticName = body.plastic_name?.trim();

  if (!manufacturer) {
    return new Response(JSON.stringify({ error: 'Manufacturer is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!plasticName) {
    return new Response(JSON.stringify({ error: 'Plastic name is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Check if plastic type already exists (case-insensitive)
    const { data: existing } = await supabase
      .from('plastic_types')
      .select('id, status')
      .ilike('manufacturer', manufacturer)
      .ilike('plastic_name', plasticName)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({
          error: 'Plastic type already exists',
          existing_status: existing.status,
        }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Insert new plastic type with pending status
    const { data: newPlastic, error: insertError } = await supabase
      .from('plastic_types')
      .insert({
        manufacturer,
        plastic_name: plasticName,
        status: 'pending',
        submitted_by: user.id,
        display_order: 999, // Will be reordered by admin when approved
      })
      .select()
      .single();

    if (insertError) {
      captureException(insertError, { operation: 'submit-plastic-type', userId: user.id });
      return new Response(JSON.stringify({ error: 'Failed to submit plastic type', details: insertError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        message: 'Plastic type submitted for review',
        plastic: newPlastic,
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    captureException(error, { operation: 'submit-plastic-type', userId: user.id });
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

Deno.serve(withSentry(handler));
