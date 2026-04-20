const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * POST /api/submit-review
 * Body: { user_id, name, city, text }
 * Creates a review with status='pending' awaiting admin approval.
 *
 * Anti-abuse:
 *  - user_id must exist
 *  - text length 10-500 chars
 *  - one pending review per user at a time (prevents flood)
 */

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, name, city, text } = req.body;

  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!name || name.trim().length < 1) return res.status(400).json({ error: 'Name required' });
  if (!text || text.trim().length < 10) return res.status(400).json({ error: 'Review text must be at least 10 characters' });
  if (text.length > 500) return res.status(400).json({ error: 'Review text must be 500 characters or less' });

  // Verify user exists
  const { data: user } = await supabase.from('users').select('id, email').eq('id', user_id).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  // One pending review per user at a time
  const { data: pending } = await supabase
    .from('reviews')
    .select('id')
    .eq('user_id', user_id)
    .eq('status', 'pending')
    .maybeSingle();

  if (pending) {
    return res.status(400).json({ error: 'You already have a review awaiting approval. Please wait for it to be reviewed.' });
  }

  try {
    const { data: review, error } = await supabase.from('reviews').insert({
      user_id,
      name: name.trim().slice(0, 60),
      city: city ? city.trim().slice(0, 60) : null,
      text: text.trim(),
      status: 'pending'
    }).select().single();

    if (error) {
      console.error('Submit review error:', error);
      return res.status(500).json({ error: 'Failed to submit review' });
    }

    console.log(`Review submitted: ${review.id} by ${user_id}`);
    return res.json({ success: true, review_id: review.id });

  } catch (err) {
    console.error('Submit review exception:', err);
    return res.status(500).json({ error: err.message });
  }
};
