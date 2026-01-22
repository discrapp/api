import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser, captureException } from '../_shared/sentry.ts';
import { notifyPlasticTypeApproved, notifyPlasticTypeRejected } from '../_shared/slack.ts';

/**
 * Approve/Reject Plastic Type Function
 *
 * Admin-only endpoint to approve or reject pending plastic type submissions.
 * Updates the Slack notification to show the action taken.
 *
 * POST /approve-plastic-type
 *
 * Request Body:
 * - plastic_id: UUID of the plastic type (required)
 * - action: 'approve' | 'reject' (required)
 *
 * Returns:
 * - The updated plastic type
 * - 403 if user is not an admin
 * - 404 if plastic type not found
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://admin.discrapp.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ApprovePlasticTypeRequest {
  plastic_id: string;
  action: 'approve' | 'reject';
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Get auth header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Authorization required' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Create Supabase client with user's auth
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  // Authenticate user
  console.log('Authenticating user...');
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    console.log('Auth failed:', authError?.message);
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log('User authenticated:', user.id, 'role:', user.app_metadata?.role);
  setUser(user.id);

  // Check if user is admin
  const userRole = user.app_metadata?.role;
  if (userRole !== 'admin') {
    console.log('User is not admin, role:', userRole);
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Parse request body
  let body: ApprovePlasticTypeRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Validate required fields
  if (!body.plastic_id) {
    return new Response(JSON.stringify({ error: 'plastic_id is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!body.action || !['approve', 'reject'].includes(body.action)) {
    return new Response(JSON.stringify({ error: 'action must be "approve" or "reject"' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Use service role to access all plastic types
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    console.log('Service role key present:', !!serviceRoleKey);
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    // Get the plastic type
    console.log('Fetching plastic type:', body.plastic_id);
    const { data: plastic, error: fetchError } = await serviceClient
      .from('plastic_types')
      .select('*')
      .eq('id', body.plastic_id)
      .single();

    console.log('Fetch result:', { plastic: !!plastic, error: fetchError?.message });

    if (fetchError || !plastic) {
      console.log('Plastic type not found, error:', fetchError);
      return new Response(JSON.stringify({ error: 'Plastic type not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Plastic type found, status:', plastic.status);
    if (plastic.status !== 'pending') {
      return new Response(JSON.stringify({ error: 'Plastic type is not pending' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.action === 'approve') {
      // Update status to approved
      console.log('Approving plastic type...');
      const { data: updated, error: updateError } = await serviceClient
        .from('plastic_types')
        .update({
          status: 'approved',
          updated_at: new Date().toISOString(),
        })
        .eq('id', body.plastic_id)
        .select()
        .single();

      console.log('Update result:', { updated: !!updated, error: updateError?.message });
      if (updateError) {
        console.error('Update error:', updateError);
        captureException(updateError, { operation: 'approve-plastic-type', plasticId: body.plastic_id });
        return new Response(JSON.stringify({ error: 'Failed to approve plastic type' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Update Slack message if we have the ts
      if (plastic.slack_message_ts) {
        await notifyPlasticTypeApproved(
          plastic.slack_message_ts,
          plastic.manufacturer,
          plastic.plastic_name,
          user.email
        );
      }

      return new Response(
        JSON.stringify({
          message: 'Plastic type approved',
          plastic: updated,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else {
      // Reject = delete the plastic type
      const { error: deleteError } = await serviceClient
        .from('plastic_types')
        .delete()
        .eq('id', body.plastic_id);

      if (deleteError) {
        captureException(deleteError, { operation: 'reject-plastic-type', plasticId: body.plastic_id });
        return new Response(JSON.stringify({ error: 'Failed to reject plastic type' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Update Slack message if we have the ts
      if (plastic.slack_message_ts) {
        await notifyPlasticTypeRejected(
          plastic.slack_message_ts,
          plastic.manufacturer,
          plastic.plastic_name,
          user.email
        );
      }

      return new Response(
        JSON.stringify({
          message: 'Plastic type rejected',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (error) {
    console.error('Unexpected error:', error);
    captureException(error, { operation: 'approve-plastic-type', plasticId: body.plastic_id });
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

Deno.serve(withSentry(handler));
