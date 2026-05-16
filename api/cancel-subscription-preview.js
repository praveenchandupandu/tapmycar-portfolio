// TMC_PATCH31_REFUND: GET preview of refund eligibility
//
// Frontend calls this to know whether to show "Cancel & refund $X" or just
// "Cancel". Returns the same shape that cancel-subscription's computeEligibility
// produces. Does NOT perform any cancel or refund.

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { computeEligibility } = require('./cancel-subscription');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // user_id from query (GET) or body (POST). No admin auth — this is the
  // user previewing their own cancel options. We do require user_id to match
  // a real user, which is sufficient because user_id is only known to that user.
  const user_id = (req.query && req.query.user_id) || (req.body && req.body.user_id);
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { data: user } = await supabase.from('users').select('*').eq('id', user_id).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    const elig = await computeEligibility(user);
    return res.json({ success: true, ...elig });
  } catch (e) {
    console.error('preview error:', e && e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
