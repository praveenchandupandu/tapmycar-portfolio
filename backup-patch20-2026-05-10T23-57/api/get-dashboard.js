const { createClient } = require('@supabase/supabase-js');

// TMC_PATCH2_ORIGIN_GUARD
function checkOrigin(req) {
  const origin = req.headers.origin;
  // Missing origin = same-origin or server-to-server, allowed
  if (!origin) return true;
  // Allowlist: tapmycar.io domains and any *.vercel.app preview
  if (origin === 'https://tapmycar.io') return true;
  if (origin === 'https://www.tapmycar.io') return true;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}


const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {

  // â”€â”€ POST â€” admin actions (update user, suspend, reactivate, profile update) â”€â”€
  if (req.method === 'POST') {
    if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden origin' });
    const { action, admin_key, user_id, name, email, phone, plan } = req.body;

    // Admin actions require admin key
    if (action && admin_key) {
      if (admin_key !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Invalid admin key' });
      }

      if (action === 'update_user' && user_id) {
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (email !== undefined) updates.email = email;
        if (plan !== undefined) updates.plan = plan;

        // TMC_PATCH6_PHONE_RESET
        // If admin changes the phone number, reset phone_verified so the
        // user must re-verify via SMS before activating new tags. The
        // verification gate enforces this; without reset, a phone change
        // would silently bypass it.
        if (phone !== undefined) {
          updates.phone = phone;
          // Look up current phone to detect actual change
          const { data: existing } = await supabase
            .from('users')
            .select('phone, phone_verified')
            .eq('id', user_id)
            .maybeSingle();
          if (existing && existing.phone !== phone) {
            updates.phone_verified = false;
            updates.phone_verified_at = null;
          }
        }

        const { error } = await supabase
          .from('users')
          .update(updates)
          .eq('id', user_id);

        if (error) return res.status(500).json({ error: error.message });
        return res.json({ success: true });
      }

      if (action === 'suspend_user' && user_id) {
        const { error } = await supabase
          .from('users')
          .update({ plan: 'suspended' })
          .eq('id', user_id);

        if (error) return res.status(500).json({ error: error.message });

        // Also deactivate all their tags
        await supabase
          .from('tags')
          .update({ status: 'disabled' })
          .eq('owner_id', user_id);

        return res.json({ success: true });
      }

      if (action === 'reactivate_user' && user_id) {
        const { error } = await supabase
          .from('users')
          .update({ plan: 'etag' })
          .eq('id', user_id);

        if (error) return res.status(500).json({ error: error.message });

        // Reactivate their tags
        await supabase
          .from('tags')
          .update({ status: 'active' })
          .eq('owner_id', user_id)
          .eq('status', 'disabled');

        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    // Regular user profile update (non-admin)
    if (user_id && name) {
      const updates = { name };
      if (email) updates.email = email;
      // TMC_PATCH6_PHONE_RESET
      // If user changes their phone, reset phone_verified so they must
      // re-verify via SMS before next activation. The activation gate
      // enforces this on next attempt.
      if (phone) {
        updates.phone = phone;
        const { data: existing } = await supabase
          .from('users')
          .select('phone')
          .eq('id', user_id)
          .maybeSingle();
        if (existing && existing.phone !== phone) {
          updates.phone_verified = false;
          updates.phone_verified_at = null;
        }
      }
        if (req.body.emergency_name !== undefined) updates.emergency_name = req.body.emergency_name;
        if (req.body.emergency_contact !== undefined) updates.emergency_contact = req.body.emergency_contact;
        // TMC_WELCOME_MSG_FIELD
        if (req.body.welcome_message !== undefined) {
          // Sanitize: max 120 chars, strip phone-like and email-like patterns
          let wm = String(req.body.welcome_message).slice(0, 120);
          wm = wm.replace(/[\d][\d\-\s\(\)\+\.]{6,}[\d]/g, '');
          wm = wm.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '');
          updates.welcome_message = wm.trim();
        }

      const { error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', user_id);

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid request' });
  }

  // â”€â”€ GET â€” dashboard data â”€â”€
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, admin } = req.query;

  // â”€â”€ ADMIN MODE â”€â”€
  if (admin) {
    if (admin !== process.env.ADMIN_SECRET_KEY) {
      return res.json({ admin: false });
    }

    // Get all users
    // TMC_PATCH19_TAGS_AND_CSV: explicit range to defeat Supabase implicit 1000-row default
    const { data: users } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false })
      .range(0, 4999);

    // Get all tags
    // TMC_PATCH19_TAGS_AND_CSV: explicit range to defeat Supabase implicit 1000-row default
    const { data: tags } = await supabase
      .from('tags')
      .select('*')
      .order('created_at', { ascending: false })
      .range(0, 4999);

    // Get total scan count
    const { count: scanCount } = await supabase
      .from('scan_logs')
      .select('*', { count: 'exact', head: true });

    // Get recent scans
    // TMC_PATCH19_TAGS_AND_CSV: scan limit 20 → 200 for admin visibility
    const { data: recentScans } = await supabase
      .from('scan_logs')
      .select('*')
      .order('scanned_at', { ascending: false })
      .limit(200);

    // Get revenue from orders
    const { data: orders } = await supabase
      .from('orders')
      .select('amount')
      .eq('status', 'paid');

    const revenue = orders ? orders.reduce((sum, o) => sum + (o.amount || 0), 0) : 0;

    const activeTagCount = tags ? tags.filter(t => t.status === 'active').length : 0;
    const unclaimedTagCount = tags ? tags.filter(t => t.status === 'unclaimed').length : 0;

    return res.json({
      admin: true,
      userCount: users ? users.length : 0,
      tagCount: tags ? tags.length : 0,
      scanCount: scanCount || 0,
      activeTagCount,
      unclaimedTagCount,
      revenue,
      users: users || [],
      tags: tags || [],
      recentScans: recentScans || []
    });
  }

  // â”€â”€ REGULAR USER MODE â”€â”€
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  // Get user
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', user_id)
    .single();

  // Get tags â€” column is owner_id
  const { data: tags } = await supabase
    .from('tags')
    .select('*')
    .eq('owner_id', user_id);

  // Get scan count
  let scanCount = 0;
  let weekCount = 0;

  if (tags && tags.length > 0) {
    const tagIds = tags.map(t => t.id);

    const { count } = await supabase
      .from('scan_logs')
      .select('*', { count: 'exact', head: true })
      .in('tag_id', tagIds);

    scanCount = count || 0;

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const { count: wc } = await supabase
      .from('scan_logs')
      .select('*', { count: 'exact', head: true })
      .in('tag_id', tagIds)
      .gte('scanned_at', weekAgo.toISOString());

    weekCount = wc || 0;
  }

  // Get recent scans
  const { data: recentScans } = await supabase
    .from('scan_logs').select('id, tag_id, action, contact_action, scanned_at, device_type, latitude, longitude, message_text, photo_url, audio_url' /* TMC_PATCH10 */).in('tag_id', tags ? tags.map(t => t.id) : [])
    .order('scanned_at', { ascending: false })
    .limit(50);

  // ─── TMC_PREMIUM_CODES_FETCH: Premium codes (buyer view) ───
  let premiumCodes = [];
  if (user && user.plan === 'premium') {
    const { data: codes } = await supabase
      .from('premium_codes')
      .select('code, redeemed_by_user_id, redeemed_at, revoked_at, created_at')
      .eq('buyer_user_id', user_id)
      .is('revoked_at', null)
      .order('created_at', { ascending: true });

    if (codes && codes.length > 0) {
      // Resolve redeemer names for redeemed codes
      const redeemerIds = codes.filter(c => c.redeemed_by_user_id).map(c => c.redeemed_by_user_id);
      let nameMap = {};
      if (redeemerIds.length > 0) {
        const { data: redeemers } = await supabase
          .from('users')
          .select('id, name')
          .in('id', redeemerIds);
        if (redeemers) redeemers.forEach(r => { nameMap[r.id] = r.name; });
      }
      // Skip the buyer's auto-assigned code (they don't need to "share" their own)
      premiumCodes = codes
        .filter(c => c.redeemed_by_user_id !== user_id)
        .map(c => ({
          code: c.code,
          redeemed: !!c.redeemed_at,
          redeemed_by_name: c.redeemed_by_user_id ? (nameMap[c.redeemed_by_user_id] || 'Family member') : null,
          redeemed_at: c.redeemed_at
        }));
    }
  }

  res.json({
    user,
    tags: tags || [],
    scanCount,
    weekCount,
    recentScans: recentScans || [],
    premiumCodes
  });
};






