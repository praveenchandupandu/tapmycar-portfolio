// TMC_VIDEOS prepare signed upload URLs for video + thumbnail.
const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');
const crypto = require('crypto');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const { video_ext, thumb_ext } = req.body || {};
  const okVideoExt = ['mp4','webm','mov'].includes(String(video_ext || '').toLowerCase());
  const okThumbExt = ['jpg','jpeg','png','webp'].includes(String(thumb_ext || '').toLowerCase());
  if (!okVideoExt) return res.status(400).json({ error: 'video_ext must be mp4/webm/mov' });

  const id = crypto.randomBytes(8).toString('hex');
  const videoPath = 'videos/' + id + '.' + String(video_ext).toLowerCase();
  const thumbPath = okThumbExt ? ('thumbs/' + id + '.' + String(thumb_ext).toLowerCase()) : null;

  try {
    const { data: vSign, error: vErr } = await supabase.storage
      .from('videos')
      .createSignedUploadUrl(videoPath);
    if (vErr) throw vErr;
    let tSign = null;
    if (thumbPath) {
      const { data, error } = await supabase.storage
        .from('videos')
        .createSignedUploadUrl(thumbPath);
      if (error) throw error;
      tSign = data;
    }
    const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '') + '/storage/v1/object/public/videos/';
    return res.json({
      ok: true,
      video: { signed_url: vSign.signedUrl, token: vSign.token, path: videoPath, public_url: baseUrl + videoPath },
      thumb: tSign ? { signed_url: tSign.signedUrl, token: tSign.token, path: thumbPath, public_url: baseUrl + thumbPath } : null
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Could not create upload URL' });
  }
};
