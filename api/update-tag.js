const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, user_id, license_plate, car_make, car_model, car_year, car_color } = req.body;

  if (!token || !user_id) {
    return res.status(400).json({ error: 'token and user_id required' });
  }

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

  // Build vehicle label
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

  res.json({ success: true, tag: data });
};