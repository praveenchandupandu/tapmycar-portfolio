// TapMyCar — proxy-call.js
// Orchestrates the masked-call flow.
//
// Two modes:
//   1. Normal call (caller_number = stranger's phone, no emergency_phone):
//      Outbound call to STRANGER first. Stranger hears warm greeting +
//      hold music + periodic nudges while we ring the OWNER. If owner
//      picks up, owner hears greeting & IVR; on press-2, owner is
//      bridged into the stranger's call.
//
//   2. Emergency call (emergency_phone provided):
//      Direct ring to emergency contact with the emergency-contact
//      script. Same IVR as normal but referencing "your friend's car".
//
// All voice is Polly.Joanna-Neural for consistency.

const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const VOICE = 'Polly.Joanna-Neural';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const { rateLimit, getClientIp } = require('./_rate-limit');

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // TMC_PATCH3_RATE_LIMIT (IP gate)
  const _tmcIp = getClientIp(req);
  if (!await rateLimit(req, res, [
    { key: 'proxy-call:ip:' + _tmcIp, max: 5, windowSeconds: 3600 }
  ])) return;


  const { token, caller_number, emergency_phone, owner_name } = req.body;

  if (!token || !caller_number) {
    return res.status(400).json({ error: 'token and caller_number required' });
  }

  // TMC_PATCH3_RATE_LIMIT (per-token limit)
  if (!await rateLimit(req, res, [
    { key: 'proxy-call:token:' + token, max: 3, windowSeconds: 3600 }
  ])) return;


  // Get tag and owner from database
  const { data: tag, error } = await supabase
    .from('tags')
    .select('*, users(phone, name)')
    .eq('token', token)
    .single();

  if (error || !tag) {
    return res.status(404).json({ error: 'Tag not found' });
  }

  if (tag.status === 'inactive' || tag.status === 'disabled') {
    return res.status(400).json({ error: 'Tag not active' });
  }

  const ownerPhone = tag.users && tag.users.phone;
  const emergencyPhone = emergency_phone;
  const rawName = owner_name || (tag.users && tag.users.name) || '';
  const friendName = safeName(rawName);
  const isEmergency = !!emergencyPhone;
  const baseUrl = `https://${req.headers.host}`;

  try {
    if (isEmergency) {
      // ── Emergency contact flow ──
      const namePiece = friendName
        ? `your friend ${escapeXml(friendName)}'s`
        : "your friend's";
      const goodbyePiece = friendName
        ? `Looks like we missed you — we'll let ${escapeXml(friendName)} know.`
        : "Looks like we missed you — we'll let them know.";

      const call = await client.calls.create({
        to: emergencyPhone,
        from: process.env.TWILIO_PHONE_NUMBER,
        twiml: `<Response>
  <Gather input="dtmf" timeout="12" numDigits="1" action="${baseUrl}/api/voice-action${friendName ? '?name=' + encodeURIComponent(friendName) : ''}" method="POST">
    <Say voice="${VOICE}">Hi there! It's TapMyCar. Someone just tapped ${namePiece} car sticker, but we couldn't get through to them. We're hoping you can help. Press one to send them a quick message. Or press two to speak with the caller directly.</Say>
  </Gather>
  <Say voice="${VOICE}">${goodbyePiece} Take care!</Say>
</Response>`
      });

      await supabase
        .from('scan_logs')
        .insert({ tag_id: tag.id, action: 'call_emergency' });

      return res.json({ success: true, call_sid: call.sid, mode: 'emergency' });
    }

    // ── Normal flow ──
    // Clean stranger number
    const cleaned = String(caller_number).replace(/\D/g, '');
    if (cleaned.length < 10) {
      return res.status(400).json({ error: 'Invalid caller number' });
    }
    const callerFormatted = cleaned.startsWith('1') ? '+' + cleaned : '+1' + cleaned;

    // Step 1: Call the STRANGER first. Stranger hears the warm greeting
    // and hold experience while we work on connecting them to the owner.
    // The stranger-wait endpoint plays greeting + hold music + nudges,
    // then dials the owner with the Joanna-Neural IVR.
    const ownerCallbackUrl = `${baseUrl}/api/owner-callback?token=${encodeURIComponent(token)}&stranger=${encodeURIComponent(callerFormatted)}${friendName ? '&name=' + encodeURIComponent(friendName) : ''}`;
    const strangerWaitUrl = `${baseUrl}/api/stranger-wait?stage=greeting&owner_url=${encodeURIComponent(ownerCallbackUrl)}`;

    const call = await client.calls.create({
      to: callerFormatted,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: strangerWaitUrl,
      method: 'POST'
    });

    await supabase
      .from('scan_logs')
      .insert({ tag_id: tag.id, action: 'call' });

    return res.json({ success: true, call_sid: call.sid, mode: 'normal' });

  } catch (err) {
    console.error('Call error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
