const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {

  // â”€â”€ POST â€” update/claim/deactivate/delete a tag â”€â”€
  if (req.method === 'POST') {
    const { token, user_id, license_plate, car_make, car_model, car_year, car_color, status_override } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'token required' });
    }

    const cleanToken = token.toUpperCase().trim();

    // Handle status override (deactivate, delete, etc.)
    if (status_override) {
      if (status_override === 'deleted') {
        const { error } = await supabase
          .from('tags')
          .delete()
          .eq('token', cleanToken);

        if (error) {
          console.error('Delete tag error:', error);
          return res.status(500).json({ error: error.message });
        }
        return res.json({ success: true, action: 'deleted' });
      }

      const { data, error } = await supabase
        .from('tags')
        .update({ status: status_override }).eq('token', cleanToken).select();

      if (error) {
        console.error('Status override error:', error);
        return res.status(500).json({ error: error.message });
      }
      return res.json({ success: true, tag: data ? data[0] : null });
    }

    // Normal claim/update
    if (!user_id) {
      return res.status(400).json({ error: 'user_id required' });
    }

    
    // Auto-deactivate eTags when physical tag activates
    // If the tag being activated is a physical sticker (not an eTag),
    // deactivate any existing eTags owned by this user. Prevents user
    // from having both eTag and physical active simultaneously.
    try {
      const { data: tagBeingActivated } = await supabase
        .from('tags')
        .select('tag_type, token')
        .eq('token', cleanToken)
        .single();

      const isPhysicalActivation = tagBeingActivated && (
        tagBeingActivated.tag_type === 'physical' ||
        (tagBeingActivated.token && tagBeingActivated.token.indexOf('TMC-ET') !== 0)
      );

      if (isPhysicalActivation) {
        const { data: existingEtags } = await supabase
          .from('tags')
          .select('id, token')
          .eq('owner_id', user_id)
          .eq('tag_type', 'etag')
          .neq('token', cleanToken)
          .in('status', ['claimed', 'active']);

        if (existingEtags && existingEtags.length > 0) {
          const etagIds = existingEtags.map(t => t.id);
          await supabase
            .from('tags')
            .update({ status: 'inactive' })
            .in('id', etagIds);
          console.log('Deactivated', existingEtags.length, 'eTag(s) for user', user_id, 'after physical activation');
        }
      }
    } catch (etagErr) {
      console.error('eTag deactivation error (non-fatal):', etagErr);
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
      .eq('token', cleanToken)
      .select()
      .single();

    if (error) {
      console.error('Update tag error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true, tag: data ? data[0] : null });
  }

  // â”€â”€ GET â€” fetch tag(s) â”€â”€
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, user_id } = req.query;

  if (token) {
    const cleanToken = token.toUpperCase().trim();

    const { data: tag, error } = await supabase
      .from('tags')
      .select('*, users(name, phone, emergency_contact, emergency_name)')
      .eq('token', cleanToken)
      .single();

    if (error || !tag) {
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




