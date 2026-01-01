import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import {
  methodNotAllowed,
  unauthorized,
  badRequest,
  notFound,
  forbidden,
  internalError,
  ErrorCode,
} from '../_shared/error-response.ts';

interface DeleteDiscRequest {
  disc_id: string;
}

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
    return unauthorized('Unauthorized', ErrorCode.INVALID_AUTH);
  }

  // Parse request body
  let body: DeleteDiscRequest;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body', ErrorCode.INVALID_JSON);
  }

  // Validate required fields
  if (!body.disc_id || body.disc_id.trim() === '') {
    return badRequest('disc_id is required', ErrorCode.MISSING_FIELD, { field: 'disc_id' });
  }

  // Verify the disc exists and belongs to the user
  const { data: disc, error: fetchError } = await supabase
    .from('discs')
    .select('id, owner_id')
    .eq('id', body.disc_id)
    .single();

  if (fetchError || !disc) {
    return notFound('Disc not found');
  }

  if (disc.owner_id !== user.id) {
    return forbidden('You do not own this disc');
  }

  // Delete the disc (cascade will handle related records like photos)
  const { error: deleteError } = await supabase.from('discs').delete().eq('id', body.disc_id);

  if (deleteError) {
    console.error('Database error:', deleteError);
    return internalError('Failed to delete disc', ErrorCode.DATABASE_ERROR, {
      message: deleteError.message,
    });
  }

  return new Response(JSON.stringify({ success: true, message: 'Disc deleted successfully' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

Deno.serve(withSentry(handler));
