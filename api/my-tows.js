// TMC_TOW_MINE: signed-in user fetches their own tow notifications.
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user_id = String(req.query.user_id || '').trim();
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { data, error } = await supabase
    .from('tow_notifications')
    .select('id, license_plate, tow_company_name, tow_company_phone, tow_company_address, message, created_at, viewed_at')
    .eq('owner_id', user_id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });

  // Mark as viewed (fire-and-forget)
  if (data && data.length) {
    const unread = data.filter(r => !r.viewed_at).map(r => r.id);
    if (unread.length) {
      supabase.from('tow_notifications').update({ viewed_at: new Date().toISOString() }).in('id', unread).then(() => {}, () => {});
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, items: data || [] });
};
