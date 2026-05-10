// TMC_PATCH15_VERIFY_GATE
// /api/verify-tags
// Admin-only endpoint to mark tokens as verified or void unverified ones.
//
// Modes:
//   POST { mode: 'verify', tokens: ['TMC-AB12CD', ...] }
//     -> marks listed tokens as verified=true, verified_at=NOW()
//     -> only affects tokens currently unclaimed AND unverified
//
//   POST { mode: 'void_unverified_in_batch', batch_number: 2 }
//     -> finds all tokens in batch where verified=false AND status='unclaimed'
//     -> sets status='voided', voided_at=NOW(), void_reason='not received from manufacturer'
//
//   POST { mode: 'void_old', days: 30 }
//     -> manual backstop: voids unverified tokens older than N days
//
// Auth: requires x-admin-key header matching ADMIN_SECRET_KEY.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Admin auth
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { mode } = req.body || {};

  if (mode === 'verify') {
    const tokens = (req.body && req.body.tokens) || [];
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({ error: 'tokens array required' });
    }
    if (tokens.length > 1000) {
      return res.status(400).json({ error: 'Max 1000 tokens per request' });
    }
    // Normalize tokens
    const cleanTokens = tokens.map(t => String(t).toUpperCase().trim()).filter(t => /^TMC-[A-Z0-9]+$/.test(t));
    if (cleanTokens.length === 0) {
      return res.status(400).json({ error: 'No valid token formats provided' });
    }

    // Only verify tokens that are currently unclaimed AND unverified
    const { data: updated, error } = await supabase
      .from('tags')
      .update({ verified: true, verified_at: new Date().toISOString() })
      .in('token', cleanTokens)
      .eq('status', 'unclaimed')
      .eq('verified', false)
      .select('token');

    if (error) return res.status(500).json({ error: error.message });
    return res.json({
      success: true,
      verified_count: updated ? updated.length : 0,
      verified_tokens: updated ? updated.map(t => t.token) : []
    });
  }

  if (mode === 'void_unverified_in_batch') {
    const batch_number = parseInt(req.body.batch_number, 10);
    if (!Number.isFinite(batch_number) || batch_number < 1) {
      return res.status(400).json({ error: 'Valid batch_number required' });
    }
    const reason = String(req.body.void_reason || 'not received from manufacturer').slice(0, 200);

    const { data: voided, error } = await supabase
      .from('tags')
      .update({
        status: 'voided',
        voided_at: new Date().toISOString(),
        void_reason: reason
      })
      .eq('batch_number', batch_number)
      .eq('verified', false)
      .eq('status', 'unclaimed')
      .select('token');

    if (error) return res.status(500).json({ error: error.message });
    return res.json({
      success: true,
      voided_count: voided ? voided.length : 0,
      voided_tokens: voided ? voided.map(t => t.token) : []
    });
  }

  if (mode === 'void_old') {
    const days = parseInt(req.body.days, 10);
    if (!Number.isFinite(days) || days < 1) {
      return res.status(400).json({ error: 'Valid days required (minimum 1)' });
    }
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const reason = 'unverified for ' + days + '+ days';

    const { data: voided, error } = await supabase
      .from('tags')
      .update({
        status: 'voided',
        voided_at: new Date().toISOString(),
        void_reason: reason
      })
      .eq('verified', false)
      .eq('status', 'unclaimed')
      .lt('created_at', cutoff)
      .select('token');

    if (error) return res.status(500).json({ error: error.message });
    return res.json({
      success: true,
      voided_count: voided ? voided.length : 0,
      voided_tokens: voided ? voided.map(t => t.token) : []
    });
  }

  return res.status(400).json({ error: 'Invalid mode. Expected: verify | void_unverified_in_batch | void_old' });
};
