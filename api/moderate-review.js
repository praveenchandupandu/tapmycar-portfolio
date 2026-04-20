const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * POST /api/moderate-review
 * Body: { review_id, action, admin_key }
 *   action: 'approve' | 'reject' | 'delete'
 *
 * Auth: requires admin_key matching ADMIN_SECRET_KEY env var
 */

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { review_id, action, admin_key } = req.body;

  if (!admin_key || admin_key !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }

  if (!review_id) return res.status(400).json({ error: 'review_id required' });
  if (!['approve', 'reject', 'delete'].includes(action)) {
    return res.status(400).json({ error: "action must be 'approve', 'reject', or 'delete'" });
  }

  try {
    if (action === 'delete') {
      const { error } = await supabase.from('reviews').delete().eq('id', review_id);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true, action: 'deleted' });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const { data: updated, error } = await supabase
      .from('reviews')
      .update({ status: newStatus, moderated_at: new Date().toISOString() })
      .eq('id', review_id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    console.log(`Review ${review_id} ${newStatus}`);
    return res.json({ success: true, action: newStatus, review: updated });

  } catch (err) {
    console.error('Moderate review exception:', err);
    return res.status(500).json({ error: err.message });
  }
};
