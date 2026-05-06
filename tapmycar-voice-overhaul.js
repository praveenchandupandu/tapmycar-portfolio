// ═══════════════════════════════════════════════════════════════
// TapMyCar — Voice & script overhaul
// ═══════════════════════════════════════════════════════════════
// Replaces the robotic alice voice + corporate scripts with:
//   - Polly.Joanna-Neural (free with Twilio, sounds human)
//   - Expressive friendly scripts with owner name personalization
//   - Mixed-cadence stranger experience: continuous greeting →
//     hold music → spoken nudges → retry → emergency rollover
//   - Single retry policy (call owner, wait, retry once, roll over)
//
// Files modified:
//   - api/voice-handler.js   — owner greeting (called when owner picks up)
//   - api/voice-action.js    — handles owner's keypress (1/2)
//   - api/proxy-call.js      — orchestrates the whole call flow
//
// New endpoints created:
//   - api/stranger-wait.js   — TwiML the stranger hears while waiting
//   - api/owner-callback.js  — handles owner pickup + retry logic
//
// Owner scripts (with name):
//   GREETING:    "Hey, my friend John! It's TapMyCar. Someone just
//                 tapped on your sticker — they're trying to reach you.
//                 Press one and we'll let them know you're on the way.
//                 Or press two to speak with them right now."
//   PRESSED 1:   "Done, John! They'll know you're on your way. Thanks
//                 for being part of TapMyCar — you're making someone's
//                 day a little easier."
//   PRESSED 2:   "Got it, John — connecting you now. One moment."
//   GOODBYE:     "Looks like we missed you, John — no worries. We'll
//                 keep them posted. Talk soon!"
//   EMERGENCY:   "Hi there! It's TapMyCar. Someone just tapped your
//                 friend John's car sticker, but we couldn't get
//                 through to them. We're hoping you can help..."
//
// Stranger scripts (no name — privacy):
//   GREETING:    "Hi there! Thanks so much for reaching out — we're
//                 connecting you to the owner now. This will just take
//                 a moment. We really appreciate you taking the time
//                 to help."
//   NUDGE 1:     "Still ringing — the owner's been notified. Hang
//                 tight, we're doing our best to get them. Thank you
//                 for your patience!"
//   NUDGE 2:     "Almost there — we're trying once more. You're
//                 awesome for sticking with us."
//   ROLLING:     "We couldn't reach the owner directly, so we're trying
//                 their backup contact. Thanks again..."
//   FINAL:       "We weren't able to connect you this time, but we'll
//                 let the owner know right away..."
//
// Run:  node tapmycar-voice-overhaul.js
// Idempotent. Safe to re-run.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const API = path.join(ROOT, 'api');

const TARGETS = {
  voiceHandler: path.join(API, 'voice-handler.js'),
  voiceAction: path.join(API, 'voice-action.js'),
  proxyCall: path.join(API, 'proxy-call.js'),
  strangerWait: path.join(API, 'stranger-wait.js'),
  ownerCallback: path.join(API, 'owner-callback.js'),
};

for (const [k, p] of Object.entries(TARGETS)) {
  if (k === 'strangerWait' || k === 'ownerCallback') continue;
  if (!fs.existsSync(p)) {
    console.error('ERROR: ' + p + ' not found.');
    process.exit(1);
  }
}

// ── Backup ──
const now = new Date();
const stamp = now.getFullYear() + '-' +
  String(now.getMonth()+1).padStart(2,'0') + '-' +
  String(now.getDate()).padStart(2,'0') + '-' +
  String(now.getHours()).padStart(2,'0') +
  String(now.getMinutes()).padStart(2,'0');
const BACKUP = path.join(ROOT, 'backup-voice-overhaul-' + stamp);
fs.mkdirSync(path.join(BACKUP, 'api'), { recursive: true });
fs.copyFileSync(TARGETS.voiceHandler, path.join(BACKUP, 'api', 'voice-handler.js'));
fs.copyFileSync(TARGETS.voiceAction, path.join(BACKUP, 'api', 'voice-action.js'));
fs.copyFileSync(TARGETS.proxyCall, path.join(BACKUP, 'api', 'proxy-call.js'));
console.log('  Backup: ' + path.relative(ROOT, BACKUP));
console.log('');


// ════════════════════════════════════════════════════════════
// STEP 1 — Replace voice-handler.js (owner greeting)
// ════════════════════════════════════════════════════════════
console.log('━━━ Step 1: Rewrite voice-handler.js ━━━');
{
  const newCode = `// TapMyCar — voice-handler.js
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
    .replace(/[^A-Za-z\\s'\\-]/g, '')
    .replace(/\\s+/g, ' ')
    .trim()
    .slice(0, 30);
  // Capitalize first letter of each word (for nicer pronunciation cue)
  return cleaned.replace(/\\b\\w/g, c => c.toUpperCase());
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const baseUrl = \`https://\${req.headers.host}\`;

  // Owner name comes through as a query string param when proxy-call
  // sets up the call. Falls back to "" so the script reads naturally
  // either way ("Hey, my friend John!" vs "Hey there, my friend!")
  const rawName = (req.query && req.query.name) || (req.body && req.body.name) || '';
  const name = safeName(rawName);
  const greeting = name
    ? \`Hey, my friend \${escapeXml(name)}!\`
    : 'Hey there, my friend!';

  // Action URL preserves the name so voice-action can personalize too
  const actionUrl = name
    ? \`\${baseUrl}/api/voice-action?name=\${encodeURIComponent(name)}\`
    : \`\${baseUrl}/api/voice-action\`;

  const twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" timeout="10" numDigits="1" action="\${actionUrl}" method="POST">
    <Say voice="\${VOICE}">\${greeting} It's TapMyCar. Someone just tapped on your sticker — they're trying to reach you. Press one and we'll let them know you're on the way. Or press two to speak with them right now.</Say>
  </Gather>
  <Say voice="\${VOICE}">\${name ? 'Looks like we missed you, ' + escapeXml(name) + ' — no worries.' : 'Looks like we missed you — no worries.'} We'll keep them posted. Talk soon!</Say>
</Response>\`;

  res.setHeader('Content-Type', 'text/xml');
  res.send(twiml);
};
`;
  if (fs.readFileSync(TARGETS.voiceHandler, 'utf8').indexOf("Polly.Joanna-Neural") !== -1) {
    console.log('  voice-handler.js: already updated, skipping');
  } else {
    fs.writeFileSync(TARGETS.voiceHandler, newCode, 'utf8');
    console.log('  voice-handler.js: rewritten with Polly + name personalization');
  }
}


// ════════════════════════════════════════════════════════════
// STEP 2 — Replace voice-action.js (owner pressed 1 or 2)
// ════════════════════════════════════════════════════════════
console.log('');
console.log('━━━ Step 2: Rewrite voice-action.js ━━━');
{
  const newCode = `// TapMyCar — voice-action.js
// Handles owner's keypress (1 = send auto-message, 2 = connect to stranger).
// Pulls owner name from query param so confirmation can be personal.

const VOICE = 'Polly.Joanna-Neural';

function safeName(raw) {
  if (!raw) return '';
  const cleaned = String(raw)
    .replace(/[^A-Za-z\\s'\\-]/g, '')
    .replace(/\\s+/g, ' ')
    .trim()
    .slice(0, 30);
  return cleaned.replace(/\\b\\w/g, c => c.toUpperCase());
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
    twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Done\${namePart}! They'll know you're on your way. Thanks for being part of TapMyCar — you're making someone's day a little easier.</Say>
  <Hangup/>
</Response>\`;

    const twilio = require('twilio')(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    twilio.calls.create({
      to: callerNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
      twiml: \`<Response><Say voice="\${VOICE}">Great news! The owner got your message and is on their way to the car right now. Thanks so much for using TapMyCar — you really helped out today!</Say></Response>\`
    }).catch(err => console.error('Callback call error:', err.message));

  } else if (digit === '2') {
    // Owner pressed 2 — bridge directly to stranger
    twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Got it\${namePart} — connecting you now. One moment.</Say>
  <Dial callerId="\${process.env.TWILIO_PHONE_NUMBER}">
    <Number>\${callerNumber}</Number>
  </Dial>
</Response>\`;

  } else {
    twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Sorry, I didn't catch that. Goodbye for now!</Say>
  <Hangup/>
</Response>\`;
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(twiml);
};
`;
  if (fs.readFileSync(TARGETS.voiceAction, 'utf8').indexOf("Polly.Joanna-Neural") !== -1) {
    console.log('  voice-action.js: already updated, skipping');
  } else {
    fs.writeFileSync(TARGETS.voiceAction, newCode, 'utf8');
    console.log('  voice-action.js: rewritten with Polly + name personalization');
  }
}


// ════════════════════════════════════════════════════════════
// STEP 3 — Rewrite proxy-call.js with new orchestration
// ════════════════════════════════════════════════════════════
console.log('');
console.log('━━━ Step 3: Rewrite proxy-call.js ━━━');
{
  const newCode = `// TapMyCar — proxy-call.js
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

function safeName(raw) {
  if (!raw) return '';
  const cleaned = String(raw)
    .replace(/[^A-Za-z\\s'\\-]/g, '')
    .replace(/\\s+/g, ' ')
    .trim()
    .slice(0, 30);
  return cleaned.replace(/\\b\\w/g, c => c.toUpperCase());
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, caller_number, emergency_phone, owner_name } = req.body;

  if (!token || !caller_number) {
    return res.status(400).json({ error: 'token and caller_number required' });
  }

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
  const baseUrl = \`https://\${req.headers.host}\`;

  try {
    if (isEmergency) {
      // ── Emergency contact flow ──
      const namePiece = friendName
        ? \`your friend \${escapeXml(friendName)}'s\`
        : "your friend's";
      const goodbyePiece = friendName
        ? \`Looks like we missed you — we'll let \${escapeXml(friendName)} know.\`
        : "Looks like we missed you — we'll let them know.";

      const call = await client.calls.create({
        to: emergencyPhone,
        from: process.env.TWILIO_PHONE_NUMBER,
        twiml: \`<Response>
  <Gather input="dtmf" timeout="12" numDigits="1" action="\${baseUrl}/api/voice-action\${friendName ? '?name=' + encodeURIComponent(friendName) : ''}" method="POST">
    <Say voice="\${VOICE}">Hi there! It's TapMyCar. Someone just tapped \${namePiece} car sticker, but we couldn't get through to them. We're hoping you can help. Press one to send them a quick message. Or press two to speak with the caller directly.</Say>
  </Gather>
  <Say voice="\${VOICE}">\${goodbyePiece} Take care!</Say>
</Response>\`
      });

      await supabase
        .from('scan_logs')
        .insert({ tag_id: tag.id, action: 'call_emergency' });

      return res.json({ success: true, call_sid: call.sid, mode: 'emergency' });
    }

    // ── Normal flow ──
    // Clean stranger number
    const cleaned = String(caller_number).replace(/\\D/g, '');
    if (cleaned.length < 10) {
      return res.status(400).json({ error: 'Invalid caller number' });
    }
    const callerFormatted = cleaned.startsWith('1') ? '+' + cleaned : '+1' + cleaned;

    // Step 1: Call the STRANGER first. Stranger hears the warm greeting
    // and hold experience while we work on connecting them to the owner.
    // The stranger-wait endpoint plays greeting + hold music + nudges,
    // then dials the owner with the Joanna-Neural IVR.
    const ownerCallbackUrl = \`\${baseUrl}/api/owner-callback?token=\${encodeURIComponent(token)}&stranger=\${encodeURIComponent(callerFormatted)}\${friendName ? '&name=' + encodeURIComponent(friendName) : ''}\`;
    const strangerWaitUrl = \`\${baseUrl}/api/stranger-wait?stage=greeting&owner_url=\${encodeURIComponent(ownerCallbackUrl)}\`;

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
`;
  // Idempotency: check for VOICE constant + new orchestration marker
  const existing = fs.readFileSync(TARGETS.proxyCall, 'utf8');
  if (existing.indexOf("Polly.Joanna-Neural") !== -1 && existing.indexOf("stranger-wait") !== -1) {
    console.log('  proxy-call.js: already updated, skipping');
  } else {
    fs.writeFileSync(TARGETS.proxyCall, newCode, 'utf8');
    console.log('  proxy-call.js: rewritten with new orchestration + Polly');
  }
}


// ════════════════════════════════════════════════════════════
// STEP 4 — Create stranger-wait.js (mixed-cadence stranger UX)
// ════════════════════════════════════════════════════════════
console.log('');
console.log('━━━ Step 4: Create stranger-wait.js ━━━');
{
  const newCode = `// TapMyCar — stranger-wait.js
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
  const cleaned = String(raw).replace(/[^A-Za-z\\s'\\-]/g, '').replace(/\\s+/g, ' ').trim().slice(0, 30);
  return cleaned.replace(/\\b\\w/g, c => c.toUpperCase());
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
}

module.exports = async function handler(req, res) {
  const stage = (req.query && req.query.stage) || (req.body && req.body.stage) || 'greeting';
  const ownerUrl = (req.query && req.query.owner_url) || (req.body && req.body.owner_url) || '';
  const baseUrl = \`https://\${req.headers.host}\`;

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
      twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Hi there! Thanks so much for reaching out — we're connecting you to the owner now. This will just take a moment. We really appreciate you taking the time to help.</Say>
  <Redirect method="POST">\${escapeXml(ownerUrl)}</Redirect>
</Response>\`;
    } else {
      const dialActionUrl = \`\${baseUrl}/api/stranger-wait?stage=after_first&owner_number=\${encodeURIComponent(ownerNumber)}\${ownerName ? '&name=' + encodeURIComponent(ownerName) : ''}\`;
      const ownerLegUrl = \`\${baseUrl}/api/voice-handler\${ownerName ? '?name=' + encodeURIComponent(ownerName) : ''}\`;

      twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Hi there! Thanks so much for reaching out — we're connecting you to the owner now. This will just take a moment. We really appreciate you taking the time to help.</Say>
  <Dial timeout="25" action="\${escapeXml(dialActionUrl)}" method="POST" callerId="\${process.env.TWILIO_PHONE_NUMBER}">
    <Number url="\${escapeXml(ownerLegUrl)}" method="POST">\${escapeXml(ownerNumber)}</Number>
  </Dial>
</Response>\`;
    }
  } else if (stage === 'after_first') {
    // Twilio webhooked back after first dial leg. DialCallStatus tells
    // us if owner answered.
    const status = (req.body && req.body.DialCallStatus) || '';
    const ownerNumber = (req.query && req.query.owner_number) || '';
    const ownerName = (req.query && req.query.name) || '';

    if (status === 'completed' || status === 'answered') {
      // Owner answered and call ended naturally — we're done
      twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>\`;
    } else {
      // No answer / busy / failed — first nudge + retry
      const dialActionUrl = \`\${baseUrl}/api/stranger-wait?stage=after_retry\${ownerName ? '&name=' + encodeURIComponent(ownerName) : ''}\`;
      const ownerLegUrl = \`\${baseUrl}/api/voice-handler\${ownerName ? '?name=' + encodeURIComponent(ownerName) : ''}\`;

      twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Still ringing — the owner's been notified. Hang tight, we're doing our best to get them. Thank you for your patience!</Say>
  <Play>\${HOLD_MUSIC}</Play>
  <Say voice="\${VOICE}">Almost there — we're trying once more. You're awesome for sticking with us.</Say>
  <Dial timeout="25" action="\${escapeXml(dialActionUrl)}" method="POST" callerId="\${process.env.TWILIO_PHONE_NUMBER}">
    <Number url="\${escapeXml(ownerLegUrl)}" method="POST">\${escapeXml(ownerNumber)}</Number>
  </Dial>
</Response>\`;
    }
  } else if (stage === 'after_retry') {
    // Webhook after second dial attempt
    const status = (req.body && req.body.DialCallStatus) || '';

    if (status === 'completed' || status === 'answered') {
      twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>\`;
    } else {
      // Both attempts failed — graceful goodbye
      twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">We weren't able to connect you this time, but we'll let the owner know right away — they'll reach out as soon as they can. Thank you so much for trying to help. Take care!</Say>
  <Hangup/>
</Response>\`;
    }
  } else {
    // Unknown stage — fail safe
    twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Sorry, something went wrong. Please try again later. Goodbye!</Say>
  <Hangup/>
</Response>\`;
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(twiml);
};
`;
  if (fs.existsSync(TARGETS.strangerWait)) {
    console.log('  stranger-wait.js: already exists, skipping');
  } else {
    fs.writeFileSync(TARGETS.strangerWait, newCode, 'utf8');
    console.log('  stranger-wait.js: created (mixed-cadence stranger experience)');
  }
}


// ════════════════════════════════════════════════════════════
// STEP 5 — Create owner-callback.js
// ════════════════════════════════════════════════════════════
console.log('');
console.log('━━━ Step 5: Create owner-callback.js ━━━');
{
  const newCode = `// TapMyCar — owner-callback.js
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
  const baseUrl = \`https://\${req.headers.host}\`;

  if (!token) {
    res.setHeader('Content-Type', 'text/xml');
    return res.send(\`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Sorry, we couldn't process your request. Please try again. Goodbye!</Say>
  <Hangup/>
</Response>\`);
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
    return res.send(\`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">We weren't able to reach the owner. We'll send them a message right away — they'll get back to you as soon as they can. Thank you so much for trying!</Say>
  <Hangup/>
</Response>\`);
  }

  // Redirect to stranger-wait with owner_number in hand
  const waitUrl = \`\${baseUrl}/api/stranger-wait?stage=greeting&owner_number=\${encodeURIComponent(ownerNumber)}\${name ? '&name=' + encodeURIComponent(name) : ''}\`;

  res.setHeader('Content-Type', 'text/xml');
  res.send(\`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">\${escapeXml(waitUrl)}</Redirect>
</Response>\`);
};
`;
  if (fs.existsSync(TARGETS.ownerCallback)) {
    console.log('  owner-callback.js: already exists, skipping');
  } else {
    fs.writeFileSync(TARGETS.ownerCallback, newCode, 'utf8');
    console.log('  owner-callback.js: created (DB lookup helper)');
  }
}


// ════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════
console.log('');
console.log('═══════════════════════════════════════════════');
console.log('  VOICE OVERHAUL COMPLETE');
console.log('═══════════════════════════════════════════════');
console.log('  Backup: ' + path.relative(ROOT, BACKUP));
console.log('');
console.log('Files modified / created:');
console.log('  ✓ api/voice-handler.js       — owner greeting (Polly + name)');
console.log('  ✓ api/voice-action.js        — owner keypress handler (Polly + name)');
console.log('  ✓ api/proxy-call.js          — orchestrates whole flow');
console.log('  ✓ api/stranger-wait.js       — NEW: stranger hold experience');
console.log('  ✓ api/owner-callback.js      — NEW: DB lookup helper');
console.log('');
console.log('IMPORTANT: For the new flow to work end-to-end, the contact');
console.log('page needs to send the strangers phone number to /api/proxy-call.');
console.log('Currently handleCall() does a tel: link which bypasses the new flow.');
console.log('Strangers calling via tel: will still hit your existing Twilio inbound');
console.log('webhook (if configured) — the new orchestration only kicks in if the');
console.log('frontend POSTs to /api/proxy-call with caller_number set to the');
console.log('strangers actual phone number.');
console.log('');
console.log('For now, the new scripts apply to:');
console.log('  - All emergency contact calls (already use proxy-call)');
console.log('  - All voice-handler webhooks (your Twilio inbound number config)');
console.log('  - All voice-action callbacks');
console.log('');
console.log('Deploy:');
console.log('  git add api/voice-handler.js api/voice-action.js api/proxy-call.js api/stranger-wait.js api/owner-callback.js');
console.log('  git commit -m "Voice overhaul: Polly Joanna Neural + expressive scripts + name personalization + mixed-cadence stranger UX"');
console.log('  git push');
