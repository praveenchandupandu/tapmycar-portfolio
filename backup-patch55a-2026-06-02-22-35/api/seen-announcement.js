// TMC_PATCH56_ANNOUNCE - records that a user dismissed an announcement,
// so it never pops up for them again. POST { user_id, announcement_id }.
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, announcement_id } = req.body || {};
  if (!user_id || !announcement_id) {
    return res.status(400).json({ error: 'user_id and announcement_id required' });
  }

  const { error } = await supabase
    .from('announcement_seen')
    .upsert(
      { user_id: String(user_id), announcement_id: announcement_id },
      { onConflict: 'announcement_id,user_id' }
    );
  if (error) {
    console.error('seen-announcement error:', error.message);
    return res.status(500).json({ error: error.message });
  }
  return res.json({ success: true });
};
