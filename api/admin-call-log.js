// TMC_CALL_HISTORY: admin endpoint - call_logs (who called through each tag).
// Every masked call logs both real numbers here (see inbound-call.js). This
// read-only endpoint powers the admin "Call history" view. Release a caller's
// number only via a lawful request.

const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const q = req.query || {};
  const limit = Math.min(parseInt(q.limit || '200', 10) || 200, 500);

  let query = supabase
    .from('call_logs')
    .select('id, created_at, bridged_at, ended_at, duration_seconds, status, tag_token, stranger_phone, owner_phone, owner_user_id, twilio_call_sid')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (q.token) {
    query = query.eq('tag_token', String(q.token).toUpperCase().trim());
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, calls: data || [] });
};
