// TMC_VIDEOS_EDIT signed upload URL for a thumbnail image only.
const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');
const crypto = require('crypto');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const { thumb_ext } = req.body || {};
  const ext = String(thumb_ext || '').toLowerCase();
  if (!['jpg','jpeg','png','webp'].includes(ext)) return res.status(400).json({ error: 'thumb_ext must be jpg/png/webp' });

  const id = crypto.randomBytes(8).toString('hex');
  const thumbPath = 'thumbs/' + id + '.' + ext;

  try {
    const { data: tSign, error } = await supabase.storage
      .from('videos')
      .createSignedUploadUrl(thumbPath);
    if (error) throw error;
    const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '') + '/storage/v1/object/public/videos/';
    return res.json({
      ok: true,
      thumb: { signed_url: tSign.signedUrl, token: tSign.token, path: thumbPath, public_url: baseUrl + thumbPath }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Could not create upload URL' });
  }
};
