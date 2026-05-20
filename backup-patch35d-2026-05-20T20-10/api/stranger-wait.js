// TapMyCar — stranger-wait.js
// What the STRANGER hears while we orchestrate the owner call.
//
// Cadence (mixed for "alive" feel):
//   stage=greeting:
//     - Continuous warm greeting (~6s)
//     - Then dial owner (Twilio Dial verb, 30s timeout, with greeting
//       baked into <Say> at top of dialed leg)
//     - On dial complete: jump to stage=after_first
//   stage=after_first (action= callback from <Dial>):
//     - DialCallStatus determines:
//         "completed" → owner answered & call ended naturally → hangup
//         "no-answer"/"failed"/"busy"/etc → first nudge + retry
//   stage=retry:
//     - Spoken nudge ("Almost there...")
//     - Brief hold music gap
//     - Dial owner SECOND time
//     - On dial complete: jump to stage=after_retry
//   stage=after_retry:
//     - If still no answer: roll-over message + hangup
//       (caller can manually trigger emergency contact via UI)

const VOICE = 'Polly.Joanna-Neural';
// Twilio's free hold music URL — official, always available
const HOLD_MUSIC = 'http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3';

function safeName(raw) {
  if (!raw) return '';
  const cleaned = String(raw).replace(/[^A-Za-z\s'\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  return cleaned.replace(/\b\w/g, c => c.toUpperCase());
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
}

module.exports = async function handler(req, res) {
  const stage = (req.query && req.query.stage) || (req.body && req.body.stage) || 'greeting';
  const ownerUrl = (req.query && req.query.owner_url) || (req.body && req.body.owner_url) || '';
  const baseUrl = `https://${req.headers.host}`;

  // For retry stage we need to call the owner again, so we re-construct
  // the dial here. The owner_url param tells us the action URL Twilio
  // will hit when our embedded dial verb completes.
  // Note: we extract owner number from owner_url query string.

  let twiml = '';

  if (stage === 'greeting') {
    // First contact with stranger — warm greeting then dial owner.
    // We use <Dial> with action= so Twilio webhooks back when the dial
    // resolves (answered or no-answer/etc).
    //
    // The dialed party (owner) hears whatever URL we point Dial's
    // <Number url=> to — that's our voice-handler endpoint.
    //
    // owner_url has format: /api/owner-callback?token=X&stranger=Y&name=Z
    // We need to extract the owner phone — but owner-callback handles
    // the actual dial. So we dial owner_url DIRECTLY as the URL handler
    // for the dial leg, not as the dialer.
    //
    // Simpler approach: use ownerUrl as the Dial action= (where Twilio
    // POSTs after dial completes). For the actual dial, we need owner
    // phone number — pass it through too.

    const ownerNumber = (req.query && req.query.owner_number) || (req.body && req.body.owner_number) || '';
    const ownerName = (req.query && req.query.name) || (req.body && req.body.name) || '';

    if (!ownerNumber) {
      // Fallback — if we don't have the owner number directly, just
      // bounce to owner-callback which has the data.
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">Hi there! Thanks so much for reaching out — we're connecting you to the owner now. This will just take a moment. We really appreciate you taking the time to help.</Say>
  <Redirect method="POST">${escapeXml(ownerUrl)}</Redirect>
</Response>`;
    } else {
      const dialActionUrl = `${baseUrl}/api/stranger-wait?stage=after_first&owner_number=${encodeURIComponent(ownerNumber)}${ownerName ? '&name=' + encodeURIComponent(ownerName) : ''}`;
      const ownerLegUrl = `${baseUrl}/api/voice-handler${ownerName ? '?name=' + encodeURIComponent(ownerName) : ''}`;

      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">Hi there! Thanks so much for reaching out — we're connecting you to the owner now. This will just take a moment. We really appreciate you taking the time to help.</Say>
  <Dial timeout="25" action="${escapeXml(dialActionUrl)}" method="POST" callerId="${process.env.TWILIO_PHONE_NUMBER}">
    <Number url="${escapeXml(ownerLegUrl)}" method="POST">${escapeXml(ownerNumber)}</Number>
  </Dial>
</Response>`;
    }
  } else if (stage === 'after_first') {
    // Twilio webhooked back after first dial leg. DialCallStatus tells
    // us if owner answered.
    const status = (req.body && req.body.DialCallStatus) || '';
    const ownerNumber = (req.query && req.query.owner_number) || '';
    const ownerName = (req.query && req.query.name) || '';

    if (status === 'completed' || status === 'answered') {
      // Owner answered and call ended naturally — we're done
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`;
    } else {
      // No answer / busy / failed — first nudge + retry
      const dialActionUrl = `${baseUrl}/api/stranger-wait?stage=after_retry${ownerName ? '&name=' + encodeURIComponent(ownerName) : ''}`;
      const ownerLegUrl = `${baseUrl}/api/voice-handler${ownerName ? '?name=' + encodeURIComponent(ownerName) : ''}`;

      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">Still ringing — the owner's been notified. Hang tight, we're doing our best to get them. Thank you for your patience!</Say>
  <Play>${HOLD_MUSIC}</Play>
  <Say voice="${VOICE}">Almost there — we're trying once more. You're awesome for sticking with us.</Say>
  <Dial timeout="25" action="${escapeXml(dialActionUrl)}" method="POST" callerId="${process.env.TWILIO_PHONE_NUMBER}">
    <Number url="${escapeXml(ownerLegUrl)}" method="POST">${escapeXml(ownerNumber)}</Number>
  </Dial>
</Response>`;
    }
  } else if (stage === 'after_retry') {
    // Webhook after second dial attempt
    const status = (req.body && req.body.DialCallStatus) || '';

    if (status === 'completed' || status === 'answered') {
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`;
    } else {
      // Both attempts failed — graceful goodbye
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">We weren't able to connect you this time, but we'll let the owner know right away — they'll reach out as soon as they can. Thank you so much for trying to help. Take care!</Say>
  <Hangup/>
</Response>`;
    }
  } else {
    // Unknown stage — fail safe
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">Sorry, something went wrong. Please try again later. Goodbye!</Say>
  <Hangup/>
</Response>`;
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(twiml);
};
