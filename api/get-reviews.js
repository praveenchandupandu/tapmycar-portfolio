const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * GET /api/get-reviews
 * Query params:
 *   limit       — max number of reviews to return (default 50)
 *   status      — 'approved' (default) | 'pending' | 'rejected' (admin only for non-approved)
 *   admin_key   — required if status != 'approved'
 *
 * Returns: { reviews: [...] }
 */

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const limit = parseInt(req.query.limit || '50', 10);
  const status = req.query.status || 'approved';
  const adminKey = req.query.admin_key || req.headers['x-admin-key'];

  // Non-public statuses require admin key
  if (status !== 'approved') {
    if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
      return res.status(401).json({ error: 'Admin authentication required' });
    }
  }

  try {
    const { data: reviews, error } = await supabase
      .from('reviews')
      .select('id, name, city, text, status, created_at, moderated_at')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 200));

    if (error) {
      console.error('Get reviews error:', error);
      return res.status(500).json({ error: 'Failed to load reviews' });
    }

    return res.json({ reviews: reviews || [] });

  } catch (err) {
    console.error('Get reviews exception:', err);
    return res.status(500).json({ error: err.message });
  }
};
