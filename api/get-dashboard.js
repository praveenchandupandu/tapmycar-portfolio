const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {

  // ── POST — update user profile ──
  if (req.method === 'POST') {
    const { user_id, name, phone, email } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    const updates = {};
    if (name) updates.name = name;
    if (phone) updates.phone = phone;
    if (email) updates.email = email;

    const { error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', user_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true });
  }

  // ── GET — load dashboard data ──
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  // Get user
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', user_id)
    .single();

  // Get tags — column is owner_id
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