// TapMyCar — voice-handler.js
// Played to the OWNER when they pick up the call.
// Personalizes greeting with owner name when available.
// Uses Polly.Joanna-Neural (free with Twilio paid account).
//
// Inputs (from Twilio webhook): To, From, plus our custom Twilio
// params we pass via the call's 'twiml' parameter at create time.
// To pass owner name, we set it as a query param on the action URL.

const VOICE = 'Polly.Joanna-Neural';

function safeName(raw) {
  if (!raw) return '';
  // Strip anything weird: only letters, spaces, hyphens, apostrophes.
  // Trim to 30 chars max so a malformed name can't break TwiML.
  const cleaned = String(raw)
    .replace(/[^A-Za-z\s'\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
  // Capitalize first letter of each word (for nicer pronunciation cue)
  return cleaned.replace(/\b\w/g, c => c.toUpperCase());
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const baseUrl = `https://${req.headers.host}`;

  // Owner name comes through as a query string param when proxy-call
  // sets up the call. Falls back to "" so the script reads naturally
  // either way ("Hey, my friend John!" vs "Hey there, my friend!")
  const rawName = (req.query && req.query.name) || (req.body && req.body.name) || '';
  const name = safeName(rawName);
  const greeting = name
    ? `Hey, my friend ${escapeXml(name)}!`
    : 'Hey there, my friend!';

  // Action URL preserves the name so voice-action can personalize too
  const actionUrl = name
    ? `${baseUrl}/api/voice-action?name=${encodeURIComponent(name)}`
    : `${baseUrl}/api/voice-action`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" timeout="10" numDigits="1" action="${actionUrl}" method="POST">
    <Say voice="${VOICE}">${greeting} It's TapMyCar. Someone just tapped on your sticker — they're trying to reach you. Press one and we'll let them know you're on the way. Or press two to speak with them right now.</Say>
  </Gather>
  <Say voice="${VOICE}">${name ? 'Looks like we missed you, ' + escapeXml(name) + ' — no worries.' : 'Looks like we missed you — no worries.'} We'll keep them posted. Talk soon!</Say>
</Response>`;

  res.setHeader('Content-Type', 'text/xml');
  res.send(twiml);
};
