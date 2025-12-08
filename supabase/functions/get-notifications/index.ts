import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Get Notifications Function
 *
 * Authenticated endpoint for fetching user's notifications.
 *
 * GET /get-notifications
 * Query params:
 *   - limit: number (default 20, max 100)
 *   - offset: number (default 0)
 *   - unread_only: boolean (default false)
 *
 * Returns:
 *   - notifications: array of notification objects
 *   - total_count: total number of notifications matching filter
 *   - unread_count: total number of unread notifications
 */

Deno.serve(async (req) => {
  // Only allow GET requests
  if (req.method !== 'GET') {
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

  // Parse query parameters
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const unreadOnly = url.searchParams.get('unread_only') === 'true';

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

  // Build query for notifications
  let query = supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  // Filter by unread if requested
  if (unreadOnly) {
    query = query.eq('read', false);
  }

  const { data: notifications, error: fetchError, count } = await query;

  if (fetchError) {
    console.error('Failed to fetch notifications:', fetchError);
    return new Response(JSON.stringify({ error: 'Failed to fetch notifications', details: fetchError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get unread count separately (always, regardless of filter)
  const { count: unreadCount, error: unreadError } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('read', false);

  if (unreadError) {
    console.error('Failed to get unread count:', unreadError);
  }

  return new Response(
    JSON.stringify({
      notifications: notifications || [],
      total_count: count || 0,
      unread_count: unreadCount || 0,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
