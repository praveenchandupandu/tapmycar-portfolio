// TapMyCar — voice-action.js
// Handles owner's keypress (1 = send auto-message, 2 = connect to stranger).
// Pulls owner name from query param so confirmation can be personal.

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
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const digit = req.body.Digits;
  const callerNumber = req.body.From || '';

  const rawName = (req.query && req.query.name) || (req.body && req.body.name) || '';
  const name = safeName(rawName);
  const namePart = name ? ', ' + escapeXml(name) : '';

  let twiml = '';

  if (digit === '1') {
    // Owner pressed 1 — confirm to owner, then call stranger back with auto-msg
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">Done${namePart}! They'll know you're on your way. Thanks for being part of TapMyCar — you're making someone's day a little easier.</Say>
  <Hangup/>
</Response>`;

    const twilio = require('twilio')(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    twilio.calls.create({
      to: callerNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
      twiml: `<Response><Say voice="${VOICE}">Great news! The owner got your message and is on their way to the car right now. Thanks so much for using TapMyCar — you really helped out today!</Say></Response>`
    }).catch(err => console.error('Callback call error:', err.message));

  } else if (digit === '2') {
    // Owner pressed 2 — bridge directly to stranger
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">Got it${namePart} — connecting you now. One moment.</Say>
  <Dial callerId="${process.env.TWILIO_PHONE_NUMBER}">
    <Number>${callerNumber}</Number>
  </Dial>
</Response>`;

  } else {
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">Sorry, I didn't catch that. Goodbye for now!</Say>
  <Hangup/>
</Response>`;
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(twiml);
};
