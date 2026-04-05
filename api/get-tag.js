const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, user_id } = req.query;

  // Get tag by token (for contact page)
  if (token) {
    const { data: tag, error } = await supabase
      .from('tags')
      .select('*, users(name, phone)')
      .eq('token', token)
      .single();

    if (error || !tag) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    // Log the scan
    await supabase
      .from('scan_logs')
      .insert({ tag_id: tag.id, action: 'view' });
// Notify owner via SMS
try {
  await fetch(`https://${req.headers.host}/api/notify-owner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_id: tag.id })
  });
} catch(e) { console.error('Notify error:', e); }

    return res.json({ tag });
  }

  // Get tag by user_id (for dashboard)
  if (user_id) {
    const { data: tags, error } = await supabase
      .from('tags')
      .select('*')
      .eq('user_id', user_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ tags });
  }

  res.status(400).json({ error: 'token or user_id required' });
};