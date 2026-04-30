// TapMyCar — owner-callback.js
// Lookup-helper endpoint. proxy-call.js's stranger flow points the
// stranger leg here, which then redirects to the actual stranger-wait
// flow with the owner's phone number resolved from the DB.
//
// Why this separate step? proxy-call.js doesn't pass ownerNumber via
// query string for security/length reasons — we look it up server-side
// when the stranger's call connects.

const { createClient } = require('@supabase/supabase-js');

const VOICE = 'Polly.Joanna-Neural';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
}

module.exports = async function handler(req, res) {
  const token = (req.query && req.query.token) || (req.body && req.body.token) || '';
  const stranger = (req.query && req.query.stranger) || (req.body && req.body.stranger) || '';
  const name = (req.query && req.query.name) || (req.body && req.body.name) || '';
  const baseUrl = `https://${req.headers.host}`;

  if (!token) {
    res.setHeader('Content-Type', 'text/xml');
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">Sorry, we couldn't process your request. Please try again. Goodbye!</Say>
  <Hangup/>
</Response>`);
  }

  // Look up owner phone
  const { data: tag } = await supabase
    .from('tags')
    .select('*, users(phone)')
    .eq('token', token)
    .single();

  const ownerNumber = tag && tag.users && tag.users.phone;

  if (!ownerNumber) {
    res.setHeader('Content-Type', 'text/xml');
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">We weren't able to reach the owner. We'll send them a message right away — they'll get back to you as soon as they can. Thank you so much for trying!</Say>
  <Hangup/>
</Response>`);
  }

  // Redirect to stranger-wait with owner_number in hand
  const waitUrl = `${baseUrl}/api/stranger-wait?stage=greeting&owner_number=${encodeURIComponent(ownerNumber)}${name ? '&name=' + encodeURIComponent(name) : ''}`;

  res.setHeader('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${escapeXml(waitUrl)}</Redirect>
</Response>`);
};
