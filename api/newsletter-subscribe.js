// TMC_PATCH52 public newsletter signup. No auth (user is mid-delete).
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, name, exit_reason } = req.body || {};

  /* Basic email validation. Server-side  client validation is courtesy. */
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email required' });
  const emailNorm = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  /* Check if already subscribed. */
  const { data: existing } = await supabase
    .from('newsletter_subscribers')
    .select('id, unsubscribed_at')
    .ilike('email', emailNorm)
    .maybeSingle();

  if (existing) {
    /* If they previously unsubscribed and now re-subscribe at delete time,
       clear the unsubscribed_at so they receive future broadcasts. */
    if (existing.unsubscribed_at) {
      await supabase.from('newsletter_subscribers').update({
        unsubscribed_at: null,
        signup_exit_reason: (typeof exit_reason === 'string') ? exit_reason.slice(0, 64) : null
      }).eq('id', existing.id);
    }
    return res.json({ ok: true, already_subscribed: true });
  }

  const { error } = await supabase.from('newsletter_subscribers').insert({
    email: emailNorm,
    name: (typeof name === 'string') ? name.trim().slice(0, 120) : null,
    signup_source: 'post_delete',
    signup_exit_reason: (typeof exit_reason === 'string') ? exit_reason.slice(0, 64) : null
  });
  if (error) {
    console.error('newsletter-subscribe insert error:', error.message);
    return res.status(500).json({ error: 'Could not subscribe' });
  }
  return res.json({ ok: true });
};
