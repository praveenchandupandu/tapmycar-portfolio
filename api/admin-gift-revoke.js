// TMC_PATCH35B_GIFT_ADMIN
// POST /api/admin-gift-revoke
//
// Admin-only. Removes the gift flag from a tag that hasn't been claimed yet.
// Tags that have already been claimed (status='active') cannot be revoked
// from here - that requires a separate refund/cancel workflow.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

let _audit = null;
try { _audit = require('./_audit').audit; } catch (e) {}

const TOKEN_RE = /^TMC-[A-Z0-9]{6,12}$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = String((req.body && req.body.token) || '').trim().toUpperCase();
  if (!token || !TOKEN_RE.test(token)) {
    return res.status(400).json({ error: 'Invalid token format' });
  }

  const { data: tag, error: tagErr } = await supabase
    .from('tags')
    .select('id, token, status, is_gift')
    .eq('token', token)
    .maybeSingle();

  if (tagErr) {
    console.error('tag lookup error:', tagErr.message);
    return res.status(500).json({ error: 'Tag lookup failed' });
  }
  if (!tag) return res.status(404).json({ error: 'Tag not found' });
  if (!tag.is_gift) return res.status(400).json({ error: 'Tag is not currently a gift' });
  if (tag.status === 'active') {
    return res.status(400).json({
      error: 'Tag is already claimed by a user. Cannot revoke from here.'
    });
  }

  const { error: updErr } = await supabase
    .from('tags')
    .update({
      is_gift: false,
      gift_plan: null,
      gift_months: null,
      gift_assigned_to_user_id: null,
      gift_note: null
    })
    .eq('id', tag.id);

  if (updErr) {
    console.error('revoke update error:', updErr.message);
    return res.status(500).json({ error: 'Failed to revoke gift' });
  }

  if (_audit) {
    try {
      await _audit({
        actor: 'admin',
        action: 'gift_revoke',
        target_type: 'tag',
        target_id: token,
        meta: {}
      });
    } catch (e) {}
  }

  return res.json({ success: true });
};
