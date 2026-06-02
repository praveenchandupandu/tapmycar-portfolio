// TMC_PATCH51A record that a user was shown but declined the retention offer.
// Sets users.retention_offer_shown_at so the gate is consumed (one-time only).
// Does NOT grant any credit.

const { createClient } = require('@supabase/supabase-js');
const { resolveUser } = require('./_auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = resolveUser(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  const user_id = auth.userId;

  const { exit_reason } = req.body || {};

  const { data: user } = await supabase
    .from('users')
    .select('retention_offer_shown_at')
    .eq('id', user_id).single();
  if (user && user.retention_offer_shown_at) {
    return res.json({ ok: true, already_shown: true });
  }

  const { error } = await supabase.from('users').update({
    retention_offer_shown_at:    new Date().toISOString(),
    /* accepted_at stays null  declined */
    retention_offer_exit_reason: (typeof exit_reason === 'string') ? exit_reason.slice(0, 64) : null
  }).eq('id', user_id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
};
