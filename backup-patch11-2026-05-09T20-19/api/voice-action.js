// TMC_PATCH9_CALL_FLOW
// TapMyCar - voice-action.js
// Called when the owner presses a key during the IVR, OR when Dial finishes.
// We are running on the OWNER leg here. The stranger is on hold on the
// inbound leg waiting for us to bridge.
//
// Press 2: speak a confirmation, then bridge owner directly into the
// stranger's incoming call leg via TwiML <Dial> with timeLimit=60s and
// a 5-second warning.
//
// Press 1: speak confirmation to owner, end owner leg. The inbound-call
// flow already has a graceful goodbye for the stranger when dial ends.
//
// Dial-finished webhook: this same endpoint also receives Twilio's
// DialCallStatus when the inbound-call's <Dial> verb completes. We use
// the same call_log_id query param to update the call_logs row with
// final status (answered, no-answer, busy, etc).

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
  res.setHeader('Content-Type', 'text/xml');

  const callLogId = (req.query && req.query.call_log_id) || (req.body && req.body.call_log_id) || '';
  const rawName = (req.query && req.query.name) || (req.body && req.body.name) || '';
  const name = safeName(rawName);
  const namePart = name ? ', ' + escapeXml(name) : '';

  // Path A: Twilio is webhooking back AFTER the inbound <Dial> finished.
  // We can tell because DialCallStatus is set.
  const dialStatus = (req.body && req.body.DialCallStatus) || (req.body && req.body.DialStatus) || '';
  if (dialStatus) {
    // Update call_logs
    if (callLogId) {
      const finalStatus = dialStatus === 'completed' ? 'completed'
        : dialStatus === 'answered' ? 'completed'
        : dialStatus === 'no-answer' ? 'no_answer'
        : dialStatus === 'busy' ? 'busy'
        : dialStatus === 'failed' ? 'failed'
        : dialStatus === 'canceled' ? 'canceled'
        : dialStatus;
      const dialDuration = parseInt((req.body && req.body.DialCallDuration) || '0', 10) || 0;
      try {
        await supabase
          .from('call_logs')
          .update({ status: finalStatus, duration_seconds: dialDuration, ended_at: new Date().toISOString() })
          .eq('id', callLogId);
      } catch (e) { console.error('call_logs update error:', e && e.message); }
    }

    // After-dial goodbye (only fires if Dial verb did not already say goodbye).
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`);
  }

  // Path B: Owner pressed a key on the IVR.
  const digit = (req.body && req.body.Digits) || '';

  if (digit === '2') {
    // Mark log as bridged
    if (callLogId) {
      try {
        await supabase
          .from('call_logs')
          .update({ status: 'bridged', bridged_at: new Date().toISOString() })
          .eq('id', callLogId);
      } catch (e) { console.error('call_logs bridge update error:', e && e.message); }
    }

    // Now bridge: continuing TwiML on the owner leg returns control to the
    // inbound-call <Dial> verb, which means the inbound-call's <Dial timeLimit="60">
    // is what governs the bridge timer. Twilio rule: when a <Number url> verb's
    // returned TwiML ends, the leg is bridged into the parent <Dial>.
    //
    // We just say a confirmation and let the leg join. The 60s timer runs
    // from when the inbound <Dial> initiated. We add a soft warning before
    // hangup using <Pause> + <Say> would interrupt the bridge - so we rely
    // on Twilio's automatic hangup at timeLimit.
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">Got it${namePart} - connecting you now. Heads up, this call ends in 60 seconds. One moment.</Say>
</Response>`);
  }

  if (digit === '1') {
    // TMC_PATCH10: notify stranger via outbound Twilio call before
    // confirming to owner. Look up call_logs for stranger_phone.
    let strangerPhone = '';
    if (callLogId) {
      try {
        const { data: cl } = await supabase
          .from('call_logs')
          .select('stranger_phone')
          .eq('id', callLogId)
          .maybeSingle();
        if (cl && cl.stranger_phone) strangerPhone = cl.stranger_phone;

        await supabase
          .from('call_logs')
          .update({ status: 'message_only', ended_at: new Date().toISOString() })
          .eq('id', callLogId);
      } catch (e) { console.error('call_logs message_only update error:', e && e.message); }
    }

    // Fire-and-forget outbound call to the stranger with the
    // owner-on-the-way message. Don't await — owner-leg TwiML returns
    // immediately. If the stranger leg is still on hold inside the
    // <Dial> verb, this outbound call will go to the stranger's phone
    // separately. (The current call leg ends naturally when our owner
    // TwiML finishes with <Hangup/>.)
    if (strangerPhone) {
      try {
        const twilioLib = require('twilio');
        const twClient = twilioLib(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        twClient.calls.create({
          to: strangerPhone,
          from: process.env.TWILIO_PHONE_NUMBER,
          twiml: `<Response><Say voice="${VOICE}">Great news! The owner got your message and is on their way to the car right now. Thanks so much for using TapMyCar - you really helped out today!</Say></Response>`
        }).catch(err => console.error('press-1 stranger call error:', err && err.message));
      } catch (e) { console.error('press-1 twilio init error:', e && e.message); }
    }

    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">Done${namePart}! They'll know you're on your way. Thanks for being part of TapMyCar.</Say>
  <Hangup/>
</Response>`);
  }

  // No digit / invalid
  return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">Sorry, I didn't catch that. Goodbye for now!</Say>
  <Hangup/>
</Response>`);
};
