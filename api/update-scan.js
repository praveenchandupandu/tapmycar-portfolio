const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { scan_id, latitude, longitude, contact_action } = req.body;
  if (!scan_id) return res.status(400).json({ error: 'scan_id required' });

  const updates = {};
  if (latitude !== undefined) updates.latitude = latitude;
  if (longitude !== undefined) updates.longitude = longitude;
  if (contact_action) updates.contact_action = contact_action;

  const { error } = await supabase
    .from('scan_logs')
    .update(updates)
    .eq('id', scan_id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true });
};