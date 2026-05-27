// TMC_PATCH35A_GIFT_ACTIVATE
// POST /api/admin-gift-activate
//
// Admin-only. Marks an unclaimed verified physical tag as gift-ready.
// Does NOT activate the tag (recipient does that by scanning + claiming).
//
// Request headers:
//   x-admin-key: <ADMIN_SECRET_KEY>
//
// Request body:
//   {
//     token: 'TMC-XXXXXX',
//     plan: 'standard' | 'premium',
//     months: 1..12,  (gift trial duration)
//     assigned_user_email?: 'user@example.com',  (optional, for pre-linked gifts)
//     note?: 'Auto show 2026'  (optional admin note)
//   }
//
// If assigned_user_email is provided, the gift is pre-linked: only that
// specific user can claim it. If omitted, the gift is OPEN — whoever
// scans + claims first becomes the recipient.
//
// Response (200):
//   {
//     success: true,
//     gift: {
//       token, plan, months, assigned_user_id (or null), note
//     }
//   }

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Optional audit hook (best-effort)
let _audit = null;
try { _audit = require('./_audit').audit; } catch (e) {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^TMC-[A-Z0-9]{6,12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Admin auth
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body || {};
  const token = String(body.token || '').trim().toUpperCase();
  const plan = String(body.plan || '').toLowerCase().trim();
  const months = parseInt(body.months, 10);
  const assignedEmail = body.assigned_user_email
    ? String(body.assigned_user_email).trim().toLowerCase()
    : null;
  const note = body.note ? String(body.note).trim().slice(0, 500) : null;

  // Validate
  if (!token || !TOKEN_RE.test(token)) {
    return res.status(400).json({ error: 'Invalid token format. Expected TMC-XXXXXX.' });
  }
  if (!['standard', 'premium'].includes(plan)) {
    return res.status(400).json({ error: 'plan must be "standard" or "premium"' });
  }
  if (!Number.isInteger(months) || months < 1 || months > 12) {
    return res.status(400).json({ error: 'months must be an integer 1..12' });
  }
  if (assignedEmail && !EMAIL_RE.test(assignedEmail)) {
    return res.status(400).json({ error: 'assigned_user_email is not a valid email' });
  }

  // Look up the tag
  const { data: tag, error: tagErr } = await supabase
    .from('tags')
    .select('id, token, status, verified, is_gift, owner_id')
    .eq('token', token)
    .maybeSingle();

  if (tagErr) {
    console.error('tag lookup error:', tagErr.message);
    return res.status(500).json({ error: 'Tag lookup failed' });
  }
  if (!tag) {
    return res.status(404).json({ error: 'Tag not found' });
  }
  if (!tag.verified) {
    return res.status(400).json({
      error: 'Tag is not verified yet. Verify it in admin before gifting.'
    });
  }
  if (tag.status !== 'unclaimed' || tag.owner_id) {
    return res.status(400).json({
      error: 'Tag is already claimed. Only unclaimed tags can be gift-activated.'
    });
  }
  if (tag.is_gift) {
    return res.status(400).json({
      error: 'Tag is already marked as a gift. Revoke first before re-gifting.'
    });
  }

  // If pre-link requested, find the user
  let assignedUserId = null;
  let assignedUserName = null;
  if (assignedEmail) {
    const { data: assignedUser, error: userErr } = await supabase
      .from('users')
      .select('id, name')
      .eq('email', assignedEmail)
      .maybeSingle();

    if (userErr) {
      console.error('assigned user lookup error:', userErr.message);
      return res.status(500).json({ error: 'User lookup failed' });
    }
    if (!assignedUser) {
      return res.status(404).json({
        error: 'No user found with email ' + assignedEmail + '. They need an account first, or use an open gift.'
      });
    }
    assignedUserId = assignedUser.id;
    assignedUserName = assignedUser.name || null;
  }

  // Mark the tag as gift-ready
  const { error: updateErr } = await supabase
    .from('tags')
    .update({
      is_gift: true,
      gift_plan: plan,
      gift_months: months,
      gift_assigned_to_user_id: assignedUserId,
      gift_note: note
    })
    .eq('id', tag.id);

  if (updateErr) {
    console.error('gift mark error:', updateErr.message);
    return res.status(500).json({ error: 'Failed to mark tag as gift' });
  }

  // Audit
  if (_audit) {
    try {
      await _audit({
        actor: 'admin',
        action: 'gift_activate',
        target_type: 'tag',
        target_id: token,
        meta: {
          plan,
          months,
          assigned_user_id: assignedUserId,
          assigned_user_email: assignedEmail,
          note
        }
      });
    } catch (e) {}
  }

  return res.json({
    success: true,
    gift: {
      token,
      plan,
      months,
      assigned_user_id: assignedUserId,
      assigned_user_name: assignedUserName,
      assigned_user_email: assignedEmail,
      note
    }
  });
};
