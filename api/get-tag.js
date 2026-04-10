const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Normalize token — try exact match first, then alternate format
async function findTag(token) {
  const clean = token.toUpperCase().trim();

  // Try exact match first
  const { data: tag1 } = await supabase
    .from('tags')
    .select('*, users(name, phone)')
    .eq('token', clean)
    .single();
  if (tag1) return tag1;

  // If token has dash (TMC-XXXXXX), try without dash (TMCXXXXXX)
  if (clean.includes('-')) {
    const noDash = clean.replace(/-/g, '');
    const { data: tag2 } = await supabase
      .from('tags')
      .select('*, users(name, phone)')
      .eq('token', noDash)
      .single();
    if (tag2) return tag2;
  }

  // If token has no dash (TMCXXXXXX), try with dash (TMC-XXXXXX)
  if (!clean.includes('-') && clean.startsWith('TMC')) {
    const withDash = 'TMC-' + clean.slice(3);
    const { data: tag3 } = await supabase
      .from('tags')
      .select('*, users(name, phone)')
      .eq('token', withDash)
      .single();
    if (tag3) return tag3;
  }

  return null;
}

// Same logic but simpler — just find the token string
async function findTokenString(token) {
  const clean = token.toUpperCase().trim();

  const { data: t1 } = await supabase.from('tags').select('token').eq('token', clean).single();
  if (t1) return t1.token;

  if (clean.includes('-')) {
    const { data: t2 } = await supabase.from('tags').select('token').eq('token', clean.replace(/-/g, '')).single();
    if (t2) return t2.token;
  }

  if (!clean.includes('-') && clean.startsWith('TMC')) {
    const { data: t3 } = await supabase.from('tags').select('token').eq('token', 'TMC-' + clean.slice(3)).single();
    if (t3) return t3.token;
  }

  return null;
}

module.exports = async function handler(req, res) {

  // ── POST — update/claim/deactivate/delete a tag ──
  if (req.method === 'POST') {
    const { token, user_id, license_plate, car_make, car_model, car_year, car_color, status_override } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'token required' });
    }

    // Find the actual token string in DB
    const actualToken = await findTokenString(token);
    if (!actualToken && status_override !== 'deleted') {
      return res.status(404).json({ error: 'Tag not found' });
    }
    const dbToken = actualToken || token.toUpperCase().trim();

    // Handle status override (deactivate, delete, etc.)
    if (status_override) {
      if (status_override === 'deleted') {
        const { error } = await supabase
          .from('tags')
          .delete()
          .eq('token', dbToken);

        if (error) {
          console.error('Delete tag error:', error);
          return res.status(500).json({ error: error.message });
        }
        return res.json({ success: true, action: 'deleted' });
      }

      const { data, error } = await supabase
        .from('tags')
        .update({ status: status_override })
        .eq('token', dbToken)
        .select()
        .single();

      if (error) {
        console.error('Status override error:', error);
        return res.status(500).json({ error: error.message });
      }
      return res.json({ success: true, tag: data });
    }

    // Normal claim/update
    if (!user_id) {
      return res.status(400).json({ error: 'user_id required' });
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

    const labelParts = [car_year, car_make, car_model].filter(Boolean);
    if (labelParts.length > 0) {
      updates.vehicle_label = labelParts.join(' ');
    }

    const { data, error } = await supabase
      .from('tags')
      .update(updates)
      .eq('token', dbToken)
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
    const tag = await findTag(token);

    if (!tag) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    let scan_id = null;
    if (tag.status === 'active' || tag.status === 'paused') {
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