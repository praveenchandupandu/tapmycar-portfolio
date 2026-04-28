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
    // TMC_GET_TAG_RESILIENT
    const cleanToken = token.toUpperCase().trim();

    // Try the full query (with welcome_message). If the column doesn't
    // exist yet (e.g. schema migration hasn't run, or PostgREST cache
    // is stale), retry without welcome_message so strangers can still
    // scan the tag. This protects against silent regressions.
    let tag = null;
    let queryError = null;

    try {
      const r = await supabase
        .from('tags')
        .select('*, users(name, phone, emergency_contact, emergency_name, welcome_message)')
        .eq('token', cleanToken)
        .single();
      if (r.error) queryError = r.error;
      else tag = r.data;
    } catch (e) {
      queryError = e;
    }

    if (!tag) {
      // Fallback: query without welcome_message
      try {
        const r2 = await supabase
          .from('tags')
          .select('*, users(name, phone, emergency_contact, emergency_name)')
          .eq('token', cleanToken)
          .single();
        if (!r2.error && r2.data) {
          tag = r2.data;
          if (tag.users) tag.users.welcome_message = null;
        } else {
          queryError = r2.error || queryError;
        }
      } catch (e) {
        queryError = e;
      }
    }

    if (!tag) {
      console.error('get-tag GET error for', cleanToken, ':', queryError?.message || queryError);
      return res.status(404).json({ error: 'Tag not found' });
    }

    // Auto-expire: if tag has expires_at set and it's past, mark inactive.
    // This handles eTags that were reactivated for 30 days as a backup.
    try {
      if (tag.expires_at) {
        const exp = new Date(tag.expires_at).getTime();
        if (Number.isFinite(exp) && exp < Date.now() && tag.status === 'active') {
          await supabase.from('tags')
            .update({ status: 'inactive' })
            .eq('id', tag.id);
          tag.status = 'inactive';
          console.log('Auto-expired tag', tag.token, '(expires_at passed)');
        }
      }
    } catch (expErr) {
      console.error('expires_at check error (non-fatal):', expErr);
    }

    // Auto-deactivate-on-read: if this is an eTag and the owner has an
    // active physical, mark this eTag inactive — UNLESS the eTag has an
    // expires_at set, which means the user explicitly reactivated it as
    // a 30-day backup. In that case, leave it active.
    try {
      const tokenUpper = (tag.token || '').toUpperCase();
      const isEtag = tokenUpper.startsWith('TMC-ET') || tag.tag_type === 'etag';
      const hasGracePeriod = !!tag.expires_at;
      if (isEtag && tag.owner_id && tag.status === 'active' && !hasGracePeriod) {
        const { data: physicalTags } = await supabase
          .from('tags')
          .select('token, status')
          .eq('owner_id', tag.owner_id)
          .eq('status', 'active')
          .neq('id', tag.id);
        const hasActivePhysical = physicalTags && physicalTags.some(t => {
          const tk = (t.token || '').toUpperCase();
          return !tk.startsWith('TMC-ET');
        });
        if (hasActivePhysical) {
          await supabase
            .from('tags')
            .update({ status: 'inactive' })
            .eq('id', tag.id);
          tag.status = 'inactive';
          console.log('Auto-deactivated eTag', tag.token, '(owner has active physical, no grace period)');
        }
      }
    } catch (autoDeactivateErr) {
      console.error('Auto-deactivate-on-read error (non-fatal):', autoDeactivateErr);
    }

    // Log scan
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




