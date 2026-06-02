// TMC_PATCH51A grant a $3 renewal-only retention credit.
// Idempotent  if retention_offer_shown_at is already set on the user,
// rejects to prevent users from farming the offer.

const { createClient } = require('@supabase/supabase-js');
const { resolveUser } = require('./_auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = resolveUser(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  const user_id = auth.userId;

  const { exit_reason } = req.body || {};

  /* Read user state for the idempotency check + audit. */
  const { data: user, error: uErr } = await supabase
    .from('users')
    .select('id, retention_offer_shown_at, retention_offer_accepted_at')
    .eq('id', user_id)
    .single();
  if (uErr || !user) return res.status(404).json({ error: 'User not found' });

  if (user.retention_offer_shown_at) {
    return res.json({ ok: false, reason: 'already_shown' });
  }

  const nowIso = new Date().toISOString();

  /* Mark on user FIRST so the idempotency gate is locked before we insert
     the credit row (avoids a race where two concurrent grants both succeed). */
  const { error: updErr } = await supabase.from('users').update({
    retention_offer_shown_at:    nowIso,
    retention_offer_accepted_at: nowIso,
    retention_offer_exit_reason: (typeof exit_reason === 'string') ? exit_reason.slice(0, 64) : null
  }).eq('id', user_id).is('retention_offer_shown_at', null);
  if (updErr) return res.status(500).json({ error: updErr.message });

  /* Verify the lock actually took (RLS/concurrent grant could have set it). */
  const { data: confirm } = await supabase
    .from('users')
    .select('retention_offer_accepted_at')
    .eq('id', user_id)
    .single();
  if (!confirm || confirm.retention_offer_accepted_at !== nowIso) {
    return res.json({ ok: false, reason: 'already_shown' });
  }

  /* Insert the renewal-only credit row. */
  const { error: refErr } = await supabase.from('referrals').insert({
    referrer_user_id: user_id,
    referred_user_id: null,
    referral_code:    'RETENTION',
    status:           'available',
    credit_amount:    3.00,
    credit_kind:      'renewal_only',
    paid_at:          nowIso,
    available_at:     nowIso,
    applied_at:       nowIso
  });
  if (refErr) {
    /* Roll back the user-side mark so the offer can be re-shown. */
    await supabase.from('users').update({
      retention_offer_shown_at:    null,
      retention_offer_accepted_at: null,
      retention_offer_exit_reason: null
    }).eq('id', user_id);
    return res.status(500).json({ error: refErr.message });
  }

  return res.json({ ok: true, credit_amount: 3.00, credit_kind: 'renewal_only' });
};
