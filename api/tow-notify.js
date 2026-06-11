// TMC_TOW_NOTIFY: tow operator submits a notification for a scanned tag.
// V2 (TMC_TOW_NOTIFY_COOKIE): reads device cookie to identify the company
// instead of trusting form body fields. Falls back to body fields if cookie
// is missing (legacy localStorage clients).
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend   = new Resend(process.env.RESEND_API_KEY);
const { rateLimit, getClientIp } = require('./_rate-limit');

function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

function readCookie(req, name) {
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  const parts = header.split(';');
  for (let i = 0; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq === -1) continue;
    if (parts[i].slice(0, eq).trim() === name) return parts[i].slice(eq + 1).trim();
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!await rateLimit(req, res, [{ key: 'tow-notify:ip:' + ip, max: 5, windowSeconds: 3600 }])) return;

  const b = req.body || {};
  const token = String(b.token || '').trim();
  const plate = String(b.license_plate || '').trim().toUpperCase().slice(0, 20);
  const message = String(b.message || '').trim().slice(0, 1000);
  if (!token || !plate) return res.status(400).json({ error: 'token and license_plate are required' });

  // Per-tag rate limit (one car can't realistically be towed multiple times per hour)
  if (!await rateLimit(req, res, [{ key: 'tow-notify:tag:' + token, max: 2, windowSeconds: 3600 }])) return;

  // === Identify the tow company ===
  // Preferred: cookie set by /api/tow-join (server-trusted)
  // Fallback: body fields (legacy clients still using localStorage)
  let towName = '', towPhone = '', towAddress = '', towCode = null;
  const cookieCode = String(readCookie(req, 'tmc_tow_co') || '').trim().toUpperCase();
  if (cookieCode) {
    const { data } = await supabase
      .from('tow_companies')
      .select('code, company_name, phone, address')
      .eq('code', cookieCode).eq('active', true).maybeSingle();
    if (data) {
      towCode = data.code;
      towName = data.company_name;
      towPhone = data.phone;
      towAddress = data.address || '';
    }
  }
  if (!towName) {
    towName    = String(b.tow_company_name    || '').trim().slice(0, 200);
    towPhone   = String(b.tow_company_phone   || '').trim().slice(0, 60);
    towAddress = String(b.tow_company_address || '').trim().slice(0, 400);
  }
  if (!towName) {
    // TMC_HARDEN_CLEAR: clear any lingering stale cookie so the device immediately
    // reverts to "Not linked yet" state on next visit
    if (cookieCode) {
      const host = String(req.headers.host || '');
      const isProd = !host.includes('localhost') && !host.includes('127.0.0.1');
      const clearParts = ['tmc_tow_co=', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
      if (isProd) clearParts.push('Secure');
      res.setHeader('Set-Cookie', clearParts.join('; '));
    }
    return res.status(403).json({ error: 'Not linked to a towing company. Open your team driver link first.' });
  }

  // Lookup tag + owner
  const { data: tag, error: tagErr } = await supabase
    .from('tags')
    .select('id, owner_id, vehicle_label, users!tags_owner_id_fkey(name, email, phone_verified)')
    .eq('token', token).maybeSingle();
  if (tagErr || !tag) return res.status(404).json({ error: 'Tag not found' });
  if (!tag.users || !tag.users.email) return res.status(404).json({ error: 'Tag owner not reachable' });

  // Persist
  const { data: notif, error: nErr } = await supabase
    .from('tow_notifications')
    .insert({
      tag_id: tag.id, owner_id: tag.owner_id,
      license_plate: plate, tow_company_name: towName,
      tow_company_phone: towPhone || null,
      tow_company_address: towAddress || null,
      tow_company_code: towCode,
      message: message || null
    })
    .select('id, created_at').single();
  if (nErr) return res.status(500).json({ error: 'Could not save notification' });

  // Increment counter on the company (best effort)
  if (towCode) {
    supabase.rpc('increment_tow_count', { p_code: towCode }).then(() => {}, () => {});
  }

  const ownerName = tag.users.name || 'there';
  const vehicle   = tag.vehicle_label || 'your vehicle';

  // Email the owner
  try {
    const phoneRow = towPhone ? '<div style="margin-top:8px"><b>Phone:</b> <a href="tel:' + esc(towPhone) + '" style="color:#FF6B00;text-decoration:none">' + esc(towPhone) + '</a></div>' : '';
    const addrRow  = towAddress ? '<div style="margin-top:8px"><b>Where to collect:</b><br>' + esc(towAddress).replace(/\n/g,'<br>') + '</div>' : '';
    const msgRow   = message ? '<div style="margin-top:14px;padding:12px;background:#FFF;border-radius:10px;font-style:italic;color:#374151"><b style="font-style:normal;color:#7C2D12">Note from the operator:</b><br>' + esc(message).replace(/\n/g,'<br>') + '</div>' : '';
    const html =
      '<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 22px;color:#111">' +
        '<div style="font-size:24px;font-weight:800;margin-bottom:4px">TapMyCar<span style="color:#FF6B00">.</span></div>' +
        '<div style="font-size:12px;color:#6B7280;margin-bottom:22px">Privacy for you. Safety for your car.</div>' +
        '<div style="background:#FFF7ED;border:1.5px solid #FED7AA;border-radius:14px;padding:18px;margin-bottom:18px">' +
          '<div style="font-size:11px;font-weight:800;color:#9A3412;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Tow notification</div>' +
          '<div style="font-size:18px;font-weight:800;color:#7C2D12;line-height:1.3;margin-bottom:8px">Your car may have been towed.</div>' +
          '<div style="font-size:14px;color:#9A3412;line-height:1.6">Hi ' + esc(ownerName) + ',<br>A towing company scanned your TapMyCar sticker on <b>' + esc(vehicle) + '</b> (plate <b>' + esc(plate) + '</b>) and sent you this notification.</div>' +
        '</div>' +
        '<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:14px;padding:18px;font-size:14px;line-height:1.6;color:#111">' +
          '<div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Towing company details</div>' +
          '<div><b>Company:</b> ' + esc(towName) + '</div>' + phoneRow + addrRow + msgRow +
        '</div>' +
        '<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;padding:14px;font-size:12px;color:#1E40AF;line-height:1.6;margin-top:18px">' +
          '<b>Heads up:</b> this message came from a tow operator who scanned your sticker. Verify the company and call them directly using the number above before driving to any address.' +
        '</div>' +
        '<a href="https://tapmycar.io/my-tows.html" style="display:block;background:#FF6B00;color:#fff;font-weight:800;font-size:14px;padding:14px 0;border-radius:12px;text-align:center;text-decoration:none;margin-top:18px">View all tow notifications</a>' +
      '</div>';
    await resend.emails.send({
      from: 'TapMyCar <noreply@tapmycar.io>',
      to: tag.users.email,
      subject: 'Tow alert: ' + towName + ' has your car (' + plate + ')',
      html
    });
  } catch (e) { console.error('tow email failed:', e && e.message); }

  // Push (best-effort)
  try {
    const webpush = require('web-push');
    webpush.setVapidDetails(process.env.VAPID_EMAIL, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('user_id', tag.owner_id);
    if (subs && subs.length) {
      const payload = JSON.stringify({ title: 'Tow alert  ' + towName, body: 'Your car (' + plate + ') was towed. Tap to view.', url: '/my-tows.html' });
      for (const sub of subs) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        } catch (err) {
          if (err.statusCode === 410) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    }
  } catch (e) { console.error('tow push failed:', e && e.message); }

  return res.json({ ok: true, id: notif.id });
};
