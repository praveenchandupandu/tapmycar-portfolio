// TMC_PATCH11_PRESS1_SINGLE
// TapMyCar - voice-action.js
//
// Three paths:
//   - Path A: Twilio webhooks back AFTER inbound <Dial> finished.
//             DialCallStatus is set. Runs on STRANGER leg.
//             We check call_logs.status:
//               - If 'message_only' (owner pressed 1): speak the
//                 "owner on the way" message to stranger, then hangup.
//               - Otherwise (bridged/no_answer/etc): just hangup.
//   - Path B-2: Owner pressed 2. Bridge by returning brief confirmation
//               TwiML on the owner leg. Twilio resumes the parent <Dial>
//               and bridges the legs. 60s timeLimit governs.
//   - Path B-1: Owner pressed 1. Mark call_logs.status='message_only'.
//               Return "Done!" TwiML to owner with <Hangup/>. The stranger
//               will be notified via Path A (after Twilio fires the dial
//               action callback on the stranger leg).
//
// No separate outbound call. Same call from start to finish.

const VOICE = 'Polly.Joanna-Neural';
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function safeName(raw) {
  if (!raw) return '';
  const cleaned = String(raw).replace(/[^A-Za-z\s'\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  return cleaned.replace(/\b\w/g, c => c.toUpperCase());
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
}

module.exports = async function handler(req, res) {
  /* TMC_PATCH28_TWILIO_SIG: verify Twilio signature on POSTs.
     Skipped on GET (Twilio sometimes uses GET for status callbacks).
     Skipped if no auth token is configured (dev only). */
  if (req.method === 'POST') {
    try {
      const _twAuth = process.env.TWILIO_AUTH_TOKEN;
      if (_twAuth) {
        const _twilio = require('twilio');
        const _sig = req.headers['x-twilio-signature'] || req.headers['X-Twilio-Signature'];
        const _proto = req.headers['x-forwarded-proto'] || 'https';
        const _host = req.headers['host'];
        const _path = req.url || '';
        const _fullUrl = _proto + '://' + _host + _path;
        const _params = (req.body && typeof req.body === 'object') ? req.body : {};
        const _valid = _sig && _twilio.validateRequest(_twAuth, _sig, _fullUrl, _params);
        if (!_valid) {
          console.warn('Twilio signature invalid for ' + _fullUrl);
          res.setHeader('Content-Type', 'text/xml');
          return res.status(403).send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
        }
      }
    } catch (_sigErr) {
      console.warn('Twilio signature check error (continuing):', _sigErr && _sigErr.message);
      // Don't block on infra error — better to accept a call than drop it.
    }
  }

  res.setHeader('Content-Type', 'text/xml');

  const callLogId = (req.query && req.query.call_log_id) || (req.body && req.body.call_log_id) || '';
  const rawName = (req.query && req.query.name) || (req.body && req.body.name) || '';
  const name = safeName(rawName);
  const namePart = name ? ', ' + escapeXml(name) : '';

  // ────────────────────────────────────────────────────────────────────
  // Path A: <Dial> action callback (runs on stranger leg)
  // Twilio sets DialCallStatus when the parent <Dial> verb finishes.
  // ────────────────────────────────────────────────────────────────────
  const dialStatus = (req.body && req.body.DialCallStatus) || (req.body && req.body.DialStatus) || '';
  if (dialStatus) {
    // Look up the call_log first to see if owner pressed 1.
    let priorStatus = '';
    if (callLogId) {
      try {
        const { data: cl } = await supabase
          .from('call_logs')
          .select('status')
          .eq('id', callLogId)
          .maybeSingle();
        if (cl) priorStatus = cl.status || '';
      } catch (e) { console.error('call_logs status read err:', e && e.message); }
    }

    // Compute the final status. If owner pressed 1 (message_only), keep it;
    // otherwise map DialCallStatus to a clean value.
    const finalStatus = priorStatus === 'message_only'
      ? 'message_only'
      : dialStatus === 'completed' ? 'completed'
      : dialStatus === 'answered' ? 'completed'
      : dialStatus === 'no-answer' ? 'no_answer'
      : dialStatus === 'busy' ? 'busy'
      : dialStatus === 'failed' ? 'failed'
      : dialStatus === 'canceled' ? 'canceled'
      : dialStatus;

    if (callLogId) {
      const dialDuration = parseInt((req.body && req.body.DialCallDuration) || '0', 10) || 0;
      try {
        await supabase
          .from('call_logs')
          .update({ status: finalStatus, duration_seconds: dialDuration, ended_at: new Date().toISOString() })
          .eq('id', callLogId);
      } catch (e) { console.error('call_logs update error:', e && e.message); }
    }

    // Branch on what we need to say to the stranger.
    if (priorStatus === 'message_only') {
      // Owner pressed 1. Speak the goodbye message to the stranger.
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">Great news! The owner got your message and is on their way to the car right now. Thanks so much for using TapMyCar - you really helped out today!</Say>
  <Hangup/>
</Response>`);
    }

    // Bridged or other status: just hangup quietly.
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`);
  }

  // ────────────────────────────────────────────────────────────────────
  // Path B: IVR keypress (runs on owner leg)
  // ────────────────────────────────────────────────────────────────────
  const digit = (req.body && req.body.Digits) || '';

  if (digit === '2') {
    // Press 2: bridge. Mark log as bridged and return brief confirmation.
    // Twilio resumes the parent <Dial>; the legs get connected.
    if (callLogId) {
      try {
        await supabase
          .from('call_logs')
          .update({ status: 'bridged', bridged_at: new Date().toISOString() })
          .eq('id', callLogId);
      } catch (e) { console.error('call_logs bridge update error:', e && e.message); }
    }

    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">Got it${namePart} - connecting you now. Heads up, this call ends in 60 seconds. One moment.</Say>
</Response>`);
  }

  if (digit === '1') {
    // Press 1: mark message_only and confirm to owner. The DialCallStatus
    // callback (Path A) will speak to the stranger after this leg ends.
    if (callLogId) {
      try {
        await supabase
          .from('call_logs')
          .update({ status: 'message_only' })
          .eq('id', callLogId);
      } catch (e) { console.error('call_logs message_only update error:', e && e.message); }
    }

    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">Done${namePart}! They'll know you're on your way. Thanks for being part of TapMyCar.</Say>
  <Hangup/>
</Response>`);
  }

  // No digit / invalid press
  return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">Sorry, I didn't catch that. Goodbye for now!</Say>
  <Hangup/>
</Response>`);
};
