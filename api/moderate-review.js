const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * POST /api/moderate-review
 * Actions: approve | reject | delete | toggle_reviews_page | toggle_landing | move_up | move_down
 */

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { review_id, action, admin_key } = req.body;

  if (!admin_key || admin_key !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  if (!review_id) return res.status(400).json({ error: 'review_id required' });

  const validActions = ['approve', 'reject', 'delete', 'toggle_reviews_page', 'toggle_landing', 'move_up', 'move_down'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Must be one of: ' + validActions.join(', ') });
  }

  try {
    const { data: review, error: fetchErr } = await supabase
      .from('reviews').select('*').eq('id', review_id).single();

    if (fetchErr || !review) return res.status(404).json({ error: 'Review not found' });

    // DELETE
    if (action === 'delete') {
      const { error } = await supabase.from('reviews').delete().eq('id', review_id);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true, action: 'deleted' });
    }

    // APPROVE / REJECT
    if (action === 'approve' || action === 'reject') {
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      const updates = { status: newStatus, moderated_at: new Date().toISOString() };
      if (action === 'approve') {
        updates.visible_on_reviews = true;
        updates.featured_on_landing = false;
      }
      const { data: updated, error } = await supabase
        .from('reviews').update(updates).eq('id', review_id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true, action: newStatus, review: updated });
    }

    // TOGGLE reviews page visibility
    if (action === 'toggle_reviews_page') {
      const newValue = !review.visible_on_reviews;
      const { data: updated, error } = await supabase
        .from('reviews').update({ visible_on_reviews: newValue }).eq('id', review_id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true, visible_on_reviews: newValue, review: updated });
    }

    // TOGGLE landing feature
    if (action === 'toggle_landing') {
      const newValue = !review.featured_on_landing;
      let landingOrder = review.landing_order || 0;

      if (newValue) {
        const { data: existing } = await supabase
          .from('reviews').select('landing_order')
          .eq('featured_on_landing', true)
          .order('landing_order', { ascending: false }).limit(1);
        landingOrder = (existing && existing.length > 0 ? existing[0].landing_order : 0) + 1;
      }

      const { data: updated, error } = await supabase
        .from('reviews')
        .update({ featured_on_landing: newValue, landing_order: landingOrder })
        .eq('id', review_id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true, featured_on_landing: newValue, review: updated });
    }

    // MOVE UP / DOWN (swap landing_order with neighbor)
    if (action === 'move_up' || action === 'move_down') {
      if (!review.featured_on_landing) {
        return res.status(400).json({ error: 'Only featured landing reviews can be reordered' });
      }

      const isUp = action === 'move_up';
      const { data: neighbors } = isUp
        ? await supabase.from('reviews').select('id, landing_order')
            .eq('featured_on_landing', true).eq('status', 'approved')
            .lt('landing_order', review.landing_order)
            .order('landing_order', { ascending: false }).limit(1)
        : await supabase.from('reviews').select('id, landing_order')
            .eq('featured_on_landing', true).eq('status', 'approved')
            .gt('landing_order', review.landing_order)
            .order('landing_order', { ascending: true }).limit(1);

      if (!neighbors || neighbors.length === 0) {
        return res.json({ success: true, note: 'Already at ' + (isUp ? 'top' : 'bottom'), no_change: true });
      }

      const neighbor = neighbors[0];
      await supabase.from('reviews').update({ landing_order: neighbor.landing_order }).eq('id', review_id);
      await supabase.from('reviews').update({ landing_order: review.landing_order }).eq('id', neighbor.id);

      return res.json({ success: true, swapped_with: neighbor.id });
    }

    return res.status(400).json({ error: 'Action not implemented' });

  } catch (err) {
    console.error('Moderate review exception:', err);
    return res.status(500).json({ error: err.message });
  }
};
