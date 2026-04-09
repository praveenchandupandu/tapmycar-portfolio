const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {

  // ── POST — update/claim/deactivate a tag ──
  if (req.method === 'POST') {
    const { token, user_id, license_plate, car_make, car_model, car_year, car_color, status_override } = req.body;

    if (!token || !user_id) {
      return res.status(400).json({ error: 'token and user_id required' });
    }

    // If status_override is set (e.g. 'inactive'), just update status
    if (status_override) {
      const { error } = await supabase
        .from('tags')
        .update({ status: status_override })
        .eq('token', token.toUpperCase())
        .eq('owner_id', user_id);

      if (error) {
        return res.status(500).json({ error: error.message });
      }
      return res.json({ success: true, status: status_override });
    }

    // Normal activation — set owner, status, vehicle details
    const updates = {
      owner_id: user_id,
      status: 'active',
      claimed_at: new Date().toISOString(),
      activated_at: new Date().toISOString()
    };

    if (license_plate) updates.license_plate = license_plate;
    if (car_make) updates.car_make = car_make;
    if (car_model) updates.car_model = car_model;
    if (car_year) updates.car_year = car_year;
    if (car_color) updates.car_color = car_color;

    const labelParts = [car_year, car_make, car_model].filter(Boolean);
    if (labelParts.length > 0) {
      updates.vehicle_label = labelParts.join(' ');
    }

    const { data, error } = await supabase
      .from('tags')
      .update(updates)
      .eq('token', token.toUpperCase())
      .select()
      .single();

    if (error) {
      console.error('Update tag error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true, tag: data });
  }

  // ── GET — fetch tag(s) ──
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, user_id } = req.query;

  if (token) {
    const { data: tag, error } = await supabase
      .from('tags')
      .select('*, users(name, phone)')
      .eq('token', token.toUpperCase())
      .single();

    if (error || !tag) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    // Log scan if tag is active
    let scan_id = null;
    if (tag.status === 'active') {
      const userAgent = req.headers['user-agent'] || '';
      const deviceType = /mobile|android|iphone|ipad/i.test(userAgent) ? 'mobile' : 'desktop';

      const { data: scan } = await supabase
        .from('scan_logs')
        .insert({
          tag_id: tag.id,
          action: 'view',
          device_type: deviceType
        })
        .select()
        .single();

      scan_id = scan?.id;
    }

    return res.json({ tag, scan_id });
  }

  if (user_id) {
    const { data: tags, error } = await supabase
      .from('tags')
      .select('*')
      .eq('owner_id', user_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ tags });
  }

  res.status(400).json({ error: 'token or user_id required' });
};