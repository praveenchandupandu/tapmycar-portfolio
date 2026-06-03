// TMC_VIDEOS_SHARE server-side rendered share page with Open Graph tags.
// Mounted at /v/:id via vercel.json rewrite.
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = async function handler(req, res) {
  const id = (req.query && req.query.id) || '';
  let video = null;
  if (id) {
    const { data } = await supabase
      .from('videos')
      .select('id, kind, title, caption, video_url, thumbnail_url, creator_name')
      .eq('id', String(id))
      .eq('active', true)
      .maybeSingle();
    video = data || null;
  }

  const siteUrl   = 'https://tapmycar.io';
  const pageUrl   = siteUrl + '/v/' + esc(id);
  const ogTitle   = video ? video.title : 'TapMyCar  Privacy-first vehicle contact';
  const ogDesc    = video ? (video.caption || video.title) : 'See how TapMyCar protects your phone number while keeping you reachable when your car needs you.';
  const ogImg     = video && video.thumbnail_url ? video.thumbnail_url : siteUrl + '/icon-512.png';
  const ogVideo   = video ? video.video_url : '';
  const creator   = video ? (video.creator_name || 'TapMyCar') : 'TapMyCar';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');

  if (!video) {
    res.status(404).send('<!doctype html><meta charset="utf-8"><title>Video not found</title><script>location.href="/landing.html"</script>');
    return;
  }

  res.send([
'<!doctype html><html lang="en"><head>',
'<meta charset="utf-8">',
'<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">',
'<title>' + esc(ogTitle) + ' \u2014 TapMyCar</title>',
'<meta name="description" content="' + esc(ogDesc) + '">',
'<meta property="og:type" content="video.other">',
'<meta property="og:site_name" content="TapMyCar">',
'<meta property="og:title" content="' + esc(ogTitle) + '">',
'<meta property="og:description" content="' + esc(ogDesc) + '">',
'<meta property="og:url" content="' + esc(pageUrl) + '">',
'<meta property="og:image" content="' + esc(ogImg) + '">',
'<meta property="og:image:width" content="720">',
'<meta property="og:image:height" content="1280">',
'<meta property="og:video" content="' + esc(ogVideo) + '">',
'<meta property="og:video:secure_url" content="' + esc(ogVideo) + '">',
'<meta property="og:video:type" content="video/mp4">',
'<meta property="og:video:width" content="720">',
'<meta property="og:video:height" content="1280">',
'<meta name="twitter:card" content="player">',
'<meta name="twitter:title" content="' + esc(ogTitle) + '">',
'<meta name="twitter:description" content="' + esc(ogDesc) + '">',
'<meta name="twitter:image" content="' + esc(ogImg) + '">',
'<meta name="twitter:player" content="' + esc(pageUrl) + '">',
'<meta name="twitter:player:width" content="720">',
'<meta name="twitter:player:height" content="1280">',
'<link rel="icon" href="/icon-192.png">',
'<style>',
'*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;background:#000;min-height:100vh;display:flex;align-items:center;justify-content:center;color:#fff}',
'.wrap{width:100%;max-width:420px;padding:24px;text-align:center}',
'.brand{display:inline-flex;align-items:center;gap:8px;margin-bottom:18px;font-size:18px;font-weight:800;color:#fff}',
'.brand-dot{width:8px;height:8px;background:#FF6B00;border-radius:50%}',
'.vid{width:100%;aspect-ratio:9/16;background:#111;border-radius:18px;overflow:hidden;margin-bottom:18px;box-shadow:0 12px 40px rgba(255,107,0,.18)}',
'video{width:100%;height:100%;object-fit:cover}',
'.title{font-size:20px;font-weight:800;margin-bottom:6px;letter-spacing:-.3px}',
'.creator{font-size:13px;color:rgba(255,255,255,.6);margin-bottom:14px}',
'.cap{font-size:14px;line-height:1.5;color:rgba(255,255,255,.8);margin-bottom:24px}',
'.cta{display:block;background:#FF6B00;color:#fff;font-weight:700;padding:14px;border-radius:12px;text-decoration:none;margin-bottom:10px}',
'.cta-sec{background:rgba(255,255,255,.1);color:#fff}',
'.foot{font-size:11px;color:rgba(255,255,255,.4);margin-top:18px}',
'</style></head><body>',
'<div class="wrap">',
'<div class="brand"><span class="brand-dot"></span>TapMyCar</div>',
'<div class="vid"><video src="' + esc(ogVideo) + '" poster="' + esc(ogImg) + '" controls autoplay playsinline></video></div>',
'<div class="title">' + esc(ogTitle) + '</div>',
'<div class="creator">@' + esc(creator) + '</div>',
'<div class="cap">' + esc(ogDesc) + '</div>',
'<a class="cta" href="/pricing.html">Get your TapMyCar sticker \u2192</a>',
'<a class="cta cta-sec" href="/landing.html">Learn more</a>',
'<div class="foot">tapmycar.io  \u00b7  Praman Tech LLC</div>',
'</div></body></html>'
  ].join('\n'));
};
