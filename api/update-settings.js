// TMC_PATCH26_APP_SETTINGS
// POST /api/update-settings
// Admin-only. Updates one or more app_settings rows.
//
// Request body:
//   {
//     updates: [
//       { key: 'app_store_url', value: 'https://...', slots: ['landing.hero', 'dashboard.banner'] },
//       ...
//     ]
//   }
//
// Auth: x-admin-key header.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Optional audit hook (best-effort)
let _audit = null;
try { _audit = require('./_audit').audit; } catch (e) {}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Admin auth
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const updates = (req.body && req.body.updates) || [];
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'updates array required' });
  }
  if (updates.length > 50) {
    return res.status(400).json({ error: 'Max 50 updates per request' });
  }

  const allowedSlots = [
    'landing.hero',
    'landing.demo',
    'landing.footer',
    'dashboard.banner',
    'dashboard.help',
    'signin.footer'
  ];

  const results = [];
  for (const u of updates) {
    if (!u || typeof u.key !== 'string' || !u.key.trim()) {
      results.push({ key: u && u.key, error: 'key required' });
      continue;
    }
    const key = u.key.trim().slice(0, 64);
    const value = u.value == null ? '' : String(u.value).slice(0, 2000);
    let slots = Array.isArray(u.slots) ? u.slots : [];
    slots = slots.filter(s => typeof s === 'string' && allowedSlots.includes(s));

    try {
      const { error } = await supabase
        .from('app_settings')
        .update({ value, slots, updated_at: new Date().toISOString(), updated_by: 'admin' })
        .eq('key', key);
      if (error) {
        results.push({ key, error: error.message });
      } else {
        results.push({ key, ok: true });
      }
    } catch (e) {
      results.push({ key, error: e && e.message });
    }
  }

  // Audit
  if (_audit) {
    try {
      _audit({
        actor: 'admin',
        action: 'update_settings',
        target_type: 'app_settings',
        meta: { keys: updates.map(u => u && u.key).filter(Boolean), count: updates.length }
      });
    } catch (e) {}
  }

  return res.json({ success: true, results });
};
