// TMC_BUSINESS_INQUIRY: handle fleet/business contact form submissions.
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);
const { rateLimit, getClientIp } = require('./_rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!await rateLimit(req, res, [{ key: 'biz-inq:ip:' + ip, max: 3, windowSeconds: 3600 }])) return;

  const b = req.body || {};
  const business_name  = String(b.business_name || '').trim().slice(0, 200);
  const contact_name   = String(b.contact_name  || '').trim().slice(0, 200);
  const email          = String(b.email         || '').trim().toLowerCase().slice(0, 200);
  const phone          = String(b.phone         || '').trim().slice(0, 60);
  const vehicle_count  = parseInt(b.vehicle_count || '0', 10) || 0;
  const message        = String(b.message       || '').trim().slice(0, 2000);
  const logo_data_url  = String(b.logo_data_url || '');

  if (!business_name || !contact_name || !email)
    return res.status(400).json({ error: 'business_name, contact_name and email are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Invalid email' });
  if (vehicle_count < 10)
    return res.status(400).json({ error: 'Minimum order is 10 stickers' });

  // Optional logo upload  store in videos bucket under logos/ subfolder.
  let logo_url = null;
  if (logo_data_url && logo_data_url.startsWith('data:image/')) {
    try {
      const match = logo_data_url.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
      if (match) {
        const mime = match[1];
        const ext  = mime.split('/')[1].replace('+xml', '').replace('jpeg', 'jpg');
        const buf  = Buffer.from(match[2], 'base64');
        if (buf.length <= 3 * 1024 * 1024) { // 3 MB cap
          const key  = 'logos/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
          const { error: upErr } = await supabase.storage.from('videos').upload(key, buf, {
            contentType: mime, upsert: false
          });
          if (!upErr) {
            const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '') + '/storage/v1/object/public/videos/';
            logo_url = base + key;
          }
        }
      }
    } catch (e) { console.error('logo upload failed:', e && e.message); }
  }

  // Persist (best-effort; tolerate table absence so the email still goes out).
  try {
    await supabase.from('business_leads').insert({
      business_name, contact_name, email, phone, vehicle_count, message, logo_url, status: 'new'
    });
  } catch (e) { console.error('business_leads insert failed:', e && e.message); }

  // Email to support
  try {
    const html =
      '<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">' +
      '<h2 style="color:#FF6B00;margin:0 0 16px">New Business / Fleet inquiry</h2>' +
      '<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:16px;font-size:14px;color:#111;line-height:1.7">' +
        '<b>Business:</b> ' + business_name + '<br>' +
        '<b>Contact:</b> ' + contact_name + '<br>' +
        '<b>Email:</b> <a href="mailto:' + email + '">' + email + '</a><br>' +
        (phone ? '<b>Phone:</b> ' + phone + '<br>' : '') +
        '<b>Vehicles / stickers:</b> ' + vehicle_count + '<br>' +
        (logo_url ? '<b>Logo:</b> <a href="' + logo_url + '">' + logo_url + '</a><br>' : '<b>Logo:</b> (none uploaded)<br>') +
      '</div>' +
      (message ? '<div style="margin-top:14px;background:#FFF7ED;border:1px solid #FED7AA;border-radius:12px;padding:14px;font-size:13px;color:#7C2D12;line-height:1.6"><b>Message:</b><br>' + message.replace(/</g,'&lt;').replace(/\n/g,'<br>') + '</div>' : '') +
      (logo_url ? '<div style="margin-top:14px"><img src="' + logo_url + '" alt="logo" style="max-width:240px;max-height:240px;border-radius:8px;border:1px solid #E5E7EB"></div>' : '') +
      '</div>';
    await resend.emails.send({
      from: 'TapMyCar <noreply@tapmycar.io>',
      to: 'support@tapmycar.io',
      reply_to: email,
      subject: 'Business / Fleet inquiry: ' + business_name + ' (' + vehicle_count + ' stickers)',
      html
    });
  } catch (e) { console.error('inquiry email send failed:', e && e.message); }

  return res.json({ ok: true });
};
