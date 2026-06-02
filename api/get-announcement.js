// TMC_PATCH55A announcement popup endpoint.
// Returns the newest active announcement the user has NOT dismissed AND
// that matches: now() in [start_date, end_date] AND audience matches user.
// Accepts GET (?user_id=) or POST { user_id }.

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const user_id = (req.method === 'POST' ? (req.body && req.body.user_id)
                                         : (req.query && req.query.user_id));
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  /* Look up the user's created_at so we can apply audience filtering. */
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, created_at')
    .eq('id', String(user_id))
    .single();
  if (userErr || !user) {
    /* If user not found, no announcement is appropriate. Fail closed. */
    return res.json({ success: true, announcement: null });
  }

  const nowIso = new Date().toISOString();

  /* Pull candidate announcements: active, within date window. We do the
     audience check in JS because it depends on per-announcement created_at
     vs. user.created_at  cleaner than two queries. */
  const { data: anns, error } = await supabase
    .from('announcements')
    .select('id, title, body, created_at, start_date, end_date, audience')
    .eq('active', true)
    .lte('start_date', nowIso)
    .gte('end_date',   nowIso)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return res.status(500).json({ error: error.message });
  if (!anns || !anns.length) return res.json({ success: true, announcement: null });

  /* Apply audience filter:
       'all'      always passes
       'existing' user must have existed BEFORE the announcement was created */
  const userCreatedMs = user.created_at ? new Date(user.created_at).getTime() : 0;
  const eligible = anns.filter(function (a) {
    const aud = a.audience || 'all';
    if (aud === 'all') return true;
    if (aud === 'existing') {
      if (!a.created_at) return false;
      return userCreatedMs > 0 && userCreatedMs < new Date(a.created_at).getTime();
    }
    return false; /* unknown audience values are ignored */
  });
  if (!eligible.length) return res.json({ success: true, announcement: null });

  /* Dismiss lookup. */
  const ids = eligible.map(function (a) { return a.id; });
  const { data: seen } = await supabase
    .from('announcement_seen')
    .select('announcement_id')
    .eq('user_id', String(user_id))
    .in('announcement_id', ids);
  const seenSet = {};
  (seen || []).forEach(function (s) { seenSet[s.announcement_id] = true; });

  const next = eligible.find(function (a) { return !seenSet[a.id]; });
  return res.json({ success: true, announcement: next || null });
};
