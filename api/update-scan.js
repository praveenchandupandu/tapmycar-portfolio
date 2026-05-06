const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// TMC_PATCH2_UPDATE_SCAN_VALIDATED
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_ALLOWLIST = new Set([
  'view', 'call', 'photo', 'voice', 'quick_message', 'emergency'
]);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { scan_id, latitude, longitude, contact_action } = req.body;
  if (!scan_id) return res.status(400).json({ error: 'scan_id required' });

  // Validate scan_id format
  if (!UUID_RE.test(String(scan_id))) {
    return res.status(400).json({ error: 'Invalid scan_id format' });
  }

  const updates = {};

  if (latitude !== undefined) {
    const lat = Number(latitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return res.status(400).json({ error: 'Invalid latitude' });
    }
    updates.latitude = lat;
  }

  if (longitude !== undefined) {
    const lng = Number(longitude);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Invalid longitude' });
    }
    updates.longitude = lng;
  }

  if (contact_action !== undefined) {
    if (!ACTION_ALLOWLIST.has(String(contact_action))) {
      return res.status(400).json({ error: 'Invalid contact_action' });
    }
    updates.contact_action = contact_action;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const { error } = await supabase
    .from('scan_logs')
    .update(updates)
    .eq('id', scan_id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true });
};
