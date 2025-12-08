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

  // Calculate 7 days ago for disc_recovered retention filter
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Build query for notifications
  // We need to fetch all notifications and then filter disc_recovered ones client-side
  // because Supabase doesn't support OR conditions with different filters per type
  let query = supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  // Filter by unread if requested
  if (unreadOnly) {
    query = query.eq('read', false);
  }

  const { data: allNotifications, error: fetchError } = await query;

  if (fetchError) {
    console.error('Failed to fetch notifications:', fetchError);
    return new Response(JSON.stringify({ error: 'Failed to fetch notifications', details: fetchError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Filter out disc_recovered notifications older than 7 days
  const filteredNotifications = (allNotifications || []).filter((notification) => {
    if (notification.type === 'disc_recovered') {
      return new Date(notification.created_at) >= sevenDaysAgo;
    }
    return true;
  });

  // Apply pagination after filtering
  const count = filteredNotifications.length;
  const notifications = filteredNotifications.slice(offset, offset + limit);

  // Get unread count (excluding old disc_recovered notifications)
  const unreadCount = filteredNotifications.filter((n) => !n.read).length;

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
