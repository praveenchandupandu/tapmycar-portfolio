// TMC_COMIC return the comic panels JSON.
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', 'comic_panels')
    .maybeSingle();

  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  if (error) return res.status(500).json({ error: error.message });

  let panels = [];
  try {
    if (data && data.value) panels = JSON.parse(data.value);
  } catch (e) { panels = []; }

  return res.json({ ok: true, panels: panels });
};
