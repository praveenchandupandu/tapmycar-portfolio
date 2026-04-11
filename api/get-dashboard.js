const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {

  // â”€â”€ POST â€” admin actions (update user, suspend, reactivate, profile update) â”€â”€
  if (req.method === 'POST') {
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
        if (phone !== undefined) updates.phone = phone;
        if (plan !== undefined) updates.plan = plan;

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
      if (phone) updates.phone = phone;
        if (req.body.emergency_name !== undefined) updates.emergency_name = req.body.emergency_name;
        if (req.body.emergency_contact !== undefined) updates.emergency_contact = req.body.emergency_contact;

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
    const { data: users } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    // Get all tags
    const { data: tags } = await supabase
      .from('tags')
      .select('*')
      .order('created_at', { ascending: false });

    // Get total scan count
    const { count: scanCount } = await supabase
      .from('scan_logs')
      .select('*', { count: 'exact', head: true });

    // Get recent scans
    const { data: recentScans } = await supabase
      .from('scan_logs')
      .select('*')
      .order('scanned_at', { ascending: false })
      .limit(20);

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
    .from('scan_logs')
    .select('*')
    .in('tag_id', tags ? tags.map(t => t.id) : [])
    .order('scanned_at', { ascending: false })
    .limit(5);

  res.json({
    user,
    tags: tags || [],
    scanCount,
    weekCount,
    recentScans: recentScans || []
  });
};



