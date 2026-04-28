// TapMyCar — /api/reactivate-etag
// Reactivates a user's eTag. If the user has an active physical sticker,
// the eTag is reactivated as a 30-day backup (expires_at = now + 30d).
// Otherwise, the eTag becomes active with no expiration.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  try {
    // Find user's tags
    const { data: tags, error: tagsErr } = await supabase
      .from('tags')
      .select('id, token, status, tag_type')
      .eq('owner_id', user_id);

    if (tagsErr) {
      console.error('reactivate-etag fetch tags error:', tagsErr);
      return res.status(500).json({ error: 'Could not fetch tags' });
    }

    // Find the eTag (token starts with TMC-ET, or tag_type='etag')
    const etag = (tags || []).find(t => {
      const tk = (t.token || '').toUpperCase();
      return tk.startsWith('TMC-ET') || t.tag_type === 'etag';
    });

    if (!etag) {
      return res.status(404).json({ error: 'No eTag found for this user' });
    }

    // Find any active physical
    const hasActivePhysical = (tags || []).some(t => {
      const tk = (t.token || '').toUpperCase();
      return !tk.startsWith('TMC-ET') && t.status === 'active';
    });

    // Build update — set status to active. If physical exists, set 30-day expiry.
    const updates = { status: 'active' };
    if (hasActivePhysical) {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      updates.expires_at = expiresAt.toISOString();
    } else {
      updates.expires_at = null;
    }

    const { error: updateErr } = await supabase
      .from('tags')
      .update(updates)
      .eq('id', etag.id);

    if (updateErr) {
      // expires_at column may not exist yet — try again without it
      if (updateErr.message && updateErr.message.toLowerCase().includes('expires_at')) {
        const { error: fallbackErr } = await supabase
          .from('tags')
          .update({ status: 'active' })
          .eq('id', etag.id);
        if (fallbackErr) {
          console.error('reactivate-etag fallback error:', fallbackErr);
          return res.status(500).json({ error: fallbackErr.message });
        }
        return res.json({
          success: true,
          expires_at: null,
          warning: 'expires_at column missing — eTag reactivated without expiration. Run the SQL migration.'
        });
      }
      console.error('reactivate-etag update error:', updateErr);
      return res.status(500).json({ error: updateErr.message });
    }

    return res.json({ success: true, expires_at: updates.expires_at });

  } catch (e) {
    console.error('reactivate-etag fatal:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};
