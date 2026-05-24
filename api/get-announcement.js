// TMC_PATCH56_ANNOUNCE - returns the newest active announcement the user
// has not yet dismissed. Used by the in-app popup. Public (user_id only).
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  // Accept GET (?user_id=) or POST { user_id }.
  const user_id = (req.method === 'POST' ? (req.body && req.body.user_id)
                                         : (req.query && req.query.user_id));
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  // Newest active announcements first.
  const { data: anns, error } = await supabase
    .from('announcements')
    .select('id, title, body, created_at')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return res.status(500).json({ error: error.message });
  if (!anns || !anns.length) return res.json({ success: true, announcement: null });

  // Which of these has this user already dismissed?
  const ids = anns.map(function (a) { return a.id; });
  const { data: seen } = await supabase
    .from('announcement_seen')
    .select('announcement_id')
    .eq('user_id', String(user_id))
    .in('announcement_id', ids);
  const seenSet = {};
  (seen || []).forEach(function (s) { seenSet[s.announcement_id] = true; });

  // First (newest) announcement not yet seen.
  const next = anns.find(function (a) { return !seenSet[a.id]; });
  return res.json({ success: true, announcement: next || null });
};
