const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * GET /api/get-reviews
 * Filters: status, visible_only, landing_only, limit, admin_key
 */

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const limit = parseInt(req.query.limit || '50', 10);
  const status = req.query.status || 'approved';
  const visibleOnly = req.query.visible_only === 'true';
  const landingOnly = req.query.landing_only === 'true';
  const adminKey = req.query.admin_key || req.headers['x-admin-key'];
  const isAdmin = adminKey === process.env.ADMIN_SECRET_KEY;

  if (status !== 'approved' && !isAdmin) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }

  try {
    let query = supabase
      .from('reviews')
      .select('id, name, city, text, status, visible_on_reviews, featured_on_landing, landing_order, created_at, moderated_at')
      .eq('status', status);

    if (landingOnly) {
      query = query.eq('featured_on_landing', true).order('landing_order', { ascending: true });
    } else if (visibleOnly) {
      query = query.eq('visible_on_reviews', true).order('created_at', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    query = query.limit(Math.min(limit, 200));

    const { data: reviews, error } = await query;

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
