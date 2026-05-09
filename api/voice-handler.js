// TMC_PATCH9_CALL_FLOW
// TapMyCar - voice-handler.js
// Played to the OWNER when they pick up the bridged call leg.
// IVR: press 1 for "I'm on my way" auto-message back, press 2 to talk.
//
// Inputs: query string carries owner name + call_log_id.

const VOICE = 'Polly.Joanna-Neural';

function safeName(raw) {
  if (!raw) return '';
  const cleaned = String(raw)
    .replace(/[^A-Za-z\s'\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
  return cleaned.replace(/\b\w/g, c => c.toUpperCase());
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
}

module.exports = async function handler(req, res) {
  const baseUrl = `https://${req.headers.host}`;
  const rawName = (req.query && req.query.name) || '';
  const callLogId = (req.query && req.query.call_log_id) || '';
  const name = safeName(rawName);

  const greeting = name
    ? `Hey, ${escapeXml(name)}!`
    : 'Hey there!';

  // Action URL preserves call_log_id and name for voice-action
  const actionUrl = `${baseUrl}/api/voice-action?call_log_id=${encodeURIComponent(callLogId)}${name ? '&name=' + encodeURIComponent(name) : ''}`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" timeout="10" numDigits="1" action="${escapeXml(actionUrl)}" method="POST">
    <Say voice="${VOICE}">${greeting} It's TapMyCar. Someone just tapped on your sticker - they're trying to reach you. Press 2 to talk with them now. Or press 1 to send them a quick message that you're on your way.</Say>
  </Gather>
  <Say voice="${VOICE}">${name ? 'Looks like we missed you, ' + escapeXml(name) + ' - no worries.' : 'Looks like we missed you - no worries.'} We'll keep them posted. Talk soon!</Say>
</Response>`;

  res.setHeader('Content-Type', 'text/xml');
  res.send(twiml);
};
