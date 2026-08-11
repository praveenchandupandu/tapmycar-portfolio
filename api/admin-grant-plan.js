// TMC_PATCH30_COMP_ADMIN
// POST /api/admin-grant-plan
//
// Admin-only. Grants or revokes a COMPED plan for an existing user. This is
// the counterpart to admin-gift-activate, which only works on UNCLAIMED tags
// and therefore cannot help an existing customer.
//
// Body:
//   action: 'grant' | 'revoke'      (required)
//   email:  'user@example.com'      (required unless token given)
//   token:  'TMC-XXXXXX'            (alternative way to find the user)
//   plan:   'standard' | 'premium'  (grant only)
//   months: 1..24                   (grant only; omit for a PERMANENT comp)
//   note:   free text               (optional, stored for your own reference)
//
// On revoke - and on natural expiry in the cron - comped_plan is cleared and
// the plan column is LEFT ALONE. The user then looks like a lapsed
// subscriber, so the renewal prompt asks them to renew while their tag keeps
// working. We deliberately do NOT deactivate tags the way the gift path does.

const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin: _tmcResolveAdminCookie } = require('./_admin-auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

let _audit = null;
try { _audit = require('./_audit').audit; } catch (e) {}

const TOKEN_RE = /^TMC-[A-Z0-9]{6,12}$/;
// Deliberately stricter than the RFC: an allow-list of characters, so
// things like '<script>@x.com' are rejected outright rather than relying on
// downstream escaping.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/;
const PLANS = ['standard', 'premium'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth first: nothing below runs for an unauthenticated caller.
  let adminKey = req.headers['x-admin-key'];
  if (_tmcResolveAdminCookie(req)) adminKey = process.env.ADMIN_SECRET_KEY;
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body || {};
  const action = String(body.action || '').toLowerCase().trim();
  if (action !== 'grant' && action !== 'revoke') {
    return res.status(400).json({ error: "action must be 'grant' or 'revoke'" });
  }

  // ---- find the user, by email or by tag token ----
  const email = String(body.email || '').toLowerCase().trim().slice(0, 254);
  const token = String(body.token || '').toUpperCase().trim();

  let user = null;

  if (email) {
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email format' });
    const { data, error } = await supabase
      .from('users')
      .select('id, email, name, plan, comped_plan, comped_plan_expires_at')
      .eq('email', email)
      .maybeSingle();
    if (error) { console.error('user lookup:', error.message); return res.status(500).json({ error: 'User lookup failed' }); }
    user = data;
  } else if (token) {
    if (!TOKEN_RE.test(token)) return res.status(400).json({ error: 'Invalid token format' });
    const { data: tag, error: tagErr } = await supabase
      .from('tags').select('owner_id').eq('token', token).maybeSingle();
    if (tagErr) { console.error('tag lookup:', tagErr.message); return res.status(500).json({ error: 'Tag lookup failed' }); }
    if (!tag) return res.status(404).json({ error: 'Tag not found' });
    if (!tag.owner_id) return res.status(400).json({ error: 'That tag is unclaimed. Use the gift flow instead.' });
    const { data, error } = await supabase
      .from('users')
      .select('id, email, name, plan, comped_plan, comped_plan_expires_at')
      .eq('id', tag.owner_id)
      .maybeSingle();
    if (error) { console.error('user lookup:', error.message); return res.status(500).json({ error: 'User lookup failed' }); }
    user = data;
  } else {
    return res.status(400).json({ error: 'Provide an email or a tag token' });
  }

  if (!user) return res.status(404).json({ error: 'No user found' });

  // ---- REVOKE ----
  if (action === 'revoke') {
    if (!user.comped_plan) {
      return res.status(400).json({ error: 'That user does not have a comped plan' });
    }
    const { error: upErr } = await supabase
      .from('users')
      .update({
        comped_plan: false,
        comped_plan_expires_at: null
        // plan intentionally untouched: user becomes 'lapsed' and is asked
        // to renew, rather than silently losing their tag.
      })
      .eq('id', user.id);
    if (upErr) { console.error('revoke failed:', upErr.message); return res.status(500).json({ error: 'Revoke failed' }); }

    if (_audit) {
      try {
        await _audit({
          actor: 'admin', action: 'comp_revoke', target_type: 'user',
          target_id: user.id, meta: { email: user.email, previous_plan: user.plan }
        });
      } catch (e) {}
    }
    return res.json({ success: true, action: 'revoke', email: user.email });
  }

  // ---- GRANT ----
  const plan = String(body.plan || '').toLowerCase().trim();
  if (!PLANS.includes(plan)) {
    return res.status(400).json({ error: "plan must be 'standard' or 'premium'" });
  }

  let expiresAt = null;
  let months = null;
  if (body.months !== undefined && body.months !== null && String(body.months).trim() !== '') {
    months = Number(body.months);
    if (!Number.isInteger(months) || months < 1 || months > 24) {
      return res.status(400).json({ error: 'months must be a whole number from 1 to 24, or omitted for permanent' });
    }
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    expiresAt = d.toISOString();
  }

  // Strip control characters so nothing odd reaches the audit log.
  const note = String(body.note || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 500);

  const { error: upErr } = await supabase
    .from('users')
    .update({
      plan: plan,
      comped_plan: true,
      comped_plan_expires_at: expiresAt,
      comped_note: note || null,
      comped_at: new Date().toISOString()
    })
    .eq('id', user.id);
  if (upErr) { console.error('grant failed:', upErr.message); return res.status(500).json({ error: 'Grant failed' }); }

  // Keep the tag's plan column in step, matching the gift-claim behaviour.
  try {
    await supabase.from('tags').update({ plan: plan }).eq('owner_id', user.id);
  } catch (e) {
    console.error('tag plan sync failed (non-fatal):', e && e.message);
  }

  if (_audit) {
    try {
      await _audit({
        actor: 'admin', action: 'comp_grant', target_type: 'user',
        target_id: user.id,
        meta: { email: user.email, plan: plan, months: months, expires_at: expiresAt, note: note }
      });
    } catch (e) {}
  }

  return res.json({
    success: true,
    action: 'grant',
    email: user.email,
    plan: plan,
    permanent: !expiresAt,
    expires_at: expiresAt
  });
};
