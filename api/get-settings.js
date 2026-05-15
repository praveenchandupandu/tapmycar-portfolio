// TMC_PATCH26_APP_SETTINGS
// GET /api/get-settings
// Returns all app settings + their slot assignments. Public, no auth.
// Cached briefly (60s) since settings rarely change.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value, slots, setting_type, label, description, sort_order')
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('get-settings error:', error.message);
      return res.status(500).json({ error: 'Failed to load settings' });
    }

    // Convert to keyed object for easier frontend access.
    const settings = {};
    (data || []).forEach(row => {
      settings[row.key] = {
        value: row.value || '',
        slots: row.slots || [],
        type: row.setting_type || 'url',
        label: row.label || row.key,
        description: row.description || ''
      };
    });

    // CDN cache 60s, browser 30s. Admin save invalidates by reload anyway.
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
    return res.json({ success: true, settings });
  } catch (e) {
    console.error('get-settings exception:', e && e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
