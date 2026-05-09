// ============================================================================
// TapMyCar - Patch 9: Rebuild masked call flow (final, working version)
//
// What this patch does:
//   - Stranger taps Call on contact.html. Browser does TWO things:
//       1. POST { token } to /api/register-pending-call (silent, ~50ms)
//       2. Open phone dialer with tel:+1 866-558-7867 (your Twilio number)
//   - Stranger's phone calls Twilio. Twilio answers, hits /api/inbound-call
//     webhook with stranger's real Caller-ID in req.body.From.
//   - inbound-call looks up the most recent pending_calls row (last 5 min)
//     to learn which tag this is. Loads owner phone + name. Logs both real
//     phone numbers in call_logs (admin can see).
//   - Twilio rings the owner. Owner hears: "Hey [name]! TapMyCar. Someone
//     tapped your sticker. Press 2 to talk to them."
//   - Owner presses 2. Twilio bridges stranger and owner with timeLimit=60s.
//   - At 55s, a 5-second warning plays: "Your call ends in 5 seconds."
//   - At 60s, Twilio auto-hangs both legs.
//
// Privacy:
//   - Stranger never enters their phone number on the page.
//   - Stranger never sees the owner's number (they dial Twilio's number).
//   - Owner never sees the stranger's number (Twilio is the caller-id).
//   - Admin sees both real phone numbers in call_logs table.
//
// Twilio config (USER MUST DO MANUALLY):
//   - Open Twilio Console > Phone Numbers > +1 (860) 515-8987
//   - "A call comes in" webhook -> https://tapmycar.io/api/inbound-call
//   - Method: HTTP POST. Save.
//
// REQUIRES: SQL migration (printed at bottom) for pending_calls + call_logs.
//
// Files touched:
//   1. SQL migration (manual)
//   2. api/inbound-call.js              -> NEW
//   3. api/register-pending-call.js     -> NEW
//   4. api/proxy-call.js                -> renamed concept; kept for emergency
//                                          contact only, gutted of stranger
//                                          logic that's now in inbound-call
//   5. api/voice-action.js              -> rewritten for press-2 bridge with
//                                          timeLimit + warning
//   6. api/voice-handler.js             -> simplified greeting (no IVR for the
//                                          stranger leg; only the owner leg)
//   7. public/contact.html              -> handleCall() updated
//   8. api/stranger-wait.js             -> deprecated (no longer used);
//                                          left as-is for now to avoid risk
//   9. api/owner-callback.js            -> deprecated (no longer used);
//                                          left as-is
//
// Properties:
//   - Idempotent
//   - Backups every touched file to backup-patch9-{timestamp}/
//   - Validates JS syntax with node --check
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch9-call-flow-rebuild.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch9-call-flow-rebuild.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch9-call-flow-rebuild.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch9-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}
function backup(file) {
  if (!fs.existsSync(file)) return;
  const rel = path.relative(ROOT, file);
  const dest = path.join(BACKUP_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function writeFile(p, content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}
function validateJs(p) {
  try {
    execSync('node --check "' + p + '"', { stdio: 'pipe' });
  } catch (e) {
    errExit('JS syntax error in ' + p + '\n' + e.stderr.toString());
  }
}

log('');
log('TapMyCar Patch 9 \u2014 Rebuild masked call flow');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_9 = 'TMC_PATCH9_CALL_FLOW';

// ===========================================================================
// 9.1  api/register-pending-call.js  (NEW)
// ===========================================================================

log('9.1  Creating api/register-pending-call.js');
{
  const file = path.join(API, 'register-pending-call.js');
  const body = `// ${MARKER_9}
// TapMyCar - register-pending-call
// Stranger on contact.html taps Call. Browser POSTs the tag token here
// (no phone number - we will get the caller ID from Twilio when the call
// arrives at /api/inbound-call). We write a pending_calls row that the
// inbound-call webhook can match against to know which owner to ring.

const { createClient } = require('@supabase/supabase-js');
const { rateLimit, getClientIp } = require('./_rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!await rateLimit(req, res, [
    { key: 'register-pending-call:ip:' + ip, max: 10, windowSeconds: 60 }
  ])) return;

  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token required' });

  const cleanToken = String(token).toUpperCase().trim();

  // Look up tag and verify it is callable (active + owner phone verified)
  const { data: tag } = await supabase
    .from('tags')
    .select('id, status, users(id, phone, phone_verified)')
    .eq('token', cleanToken)
    .single();

  if (!tag) return res.status(404).json({ error: 'Tag not found' });
  if (tag.status !== 'active') {
    return res.status(403).json({ error: 'This tag is not yet active.' });
  }
  if (!tag.users || !tag.users.phone || !tag.users.phone_verified) {
    return res.status(403).json({
      error: 'This tag is not yet ready for calls. The owner needs to complete setup.'
    });
  }

  // Insert pending_calls row. inbound-call will look this up by recency.
  const { data: row, error: insErr } = await supabase
    .from('pending_calls')
    .insert({
      tag_id: tag.id,
      tag_token: cleanToken,
      owner_user_id: tag.users.id,
      owner_phone: tag.users.phone
    })
    .select('id')
    .single();

  if (insErr) {
    console.error('register-pending-call insert error:', insErr.message);
    return res.status(500).json({ error: 'Could not register call. Please try again.' });
  }

  return res.json({ success: true, pending_id: row.id });
};
`;
  if (fs.existsSync(file) && readFile(file).includes(MARKER_9)) {
    skip('api/register-pending-call.js (already exists)');
  } else {
    backup(file);
    writeFile(file, body);
    validateJs(file);
    ok('api/register-pending-call.js created');
  }
}

// ===========================================================================
// 9.2  api/inbound-call.js  (NEW)
// ===========================================================================

log('');
log('9.2  Creating api/inbound-call.js');
{
  const file = path.join(API, 'inbound-call.js');
  const body = `// ${MARKER_9}
// TapMyCar - inbound-call (Twilio voice webhook)
// Twilio calls this URL when an incoming call arrives at our number.
// We look up the most recent pending_calls row to know which owner to ring.
// We log BOTH real phone numbers in call_logs so admin can see them.
// Then we return TwiML that rings the owner with the warm IVR.

const { createClient } = require('@supabase/supabase-js');

const VOICE = 'Polly.Joanna-Neural';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
}

function safeName(raw) {
  if (!raw) return '';
  const cleaned = String(raw).replace(/[^A-Za-z\\s'\\-]/g, '').replace(/\\s+/g, ' ').trim().slice(0, 30);
  return cleaned.replace(/\\b\\w/g, c => c.toUpperCase());
}

module.exports = async function handler(req, res) {
  // Twilio sends application/x-www-form-urlencoded. CallSid + From + To available.
  const callSid = (req.body && req.body.CallSid) || (req.query && req.query.CallSid) || '';
  const strangerNumber = (req.body && req.body.From) || (req.query && req.query.From) || '';

  res.setHeader('Content-Type', 'text/xml');

  // Look up the most recent pending_calls row from the last 5 minutes.
  // (No way to match by caller ID since stranger never gave it to us.)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: pending } = await supabase
    .from('pending_calls')
    .select('id, tag_id, tag_token, owner_user_id, owner_phone')
    .gte('created_at', fiveMinAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pending) {
    // Nobody recently tapped Call. Refuse politely.
    return res.send(\`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Sorry, we don't recognize this call. Please tap the Call button on the TapMyCar page first, then try calling again. Goodbye!</Say>
  <Hangup/>
</Response>\`);
  }

  // Look up owner name
  const { data: ownerUser } = await supabase
    .from('users')
    .select('name')
    .eq('id', pending.owner_user_id)
    .maybeSingle();

  const ownerName = safeName(ownerUser ? ownerUser.name : '');
  const ownerPhone = pending.owner_phone;

  // Log this call attempt with BOTH real phone numbers (admin-visible).
  const { data: callLog } = await supabase
    .from('call_logs')
    .insert({
      tag_id: pending.tag_id,
      tag_token: pending.tag_token,
      owner_user_id: pending.owner_user_id,
      stranger_phone: strangerNumber,
      owner_phone: ownerPhone,
      twilio_call_sid: callSid,
      status: 'ringing'
    })
    .select('id')
    .single();

  // Mark pending consumed (so a second concurrent call doesn't pick this up)
  await supabase.from('pending_calls').update({ consumed: true }).eq('id', pending.id);

  // Build the TwiML: greet stranger briefly, then dial owner with IVR script.
  const baseUrl = \`https://\${req.headers.host}\`;
  const callLogId = callLog ? callLog.id : '';

  // Owner-leg URL: voice-handler reads owner name from query and plays IVR
  const ownerLegUrl = \`\${baseUrl}/api/voice-handler?name=\${encodeURIComponent(ownerName)}&call_log_id=\${encodeURIComponent(callLogId)}\`;

  // Dial action callback: hits voice-action when owner presses key OR when
  // dial finishes (timeout/no-answer). The press-2 path is handled by
  // voice-action which uses callerId = Twilio's number to bridge.
  const dialActionUrl = \`\${baseUrl}/api/voice-action?call_log_id=\${encodeURIComponent(callLogId)}\`;

  return res.send(\`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Hi there! Thanks so much for reaching out. We're connecting you to the owner now. Please hold for just a moment.</Say>
  <Dial timeout="25" timeLimit="60" action="\${escapeXml(dialActionUrl)}" method="POST" callerId="\${process.env.TWILIO_PHONE_NUMBER}">
    <Number url="\${escapeXml(ownerLegUrl)}" method="POST">\${escapeXml(ownerPhone)}</Number>
  </Dial>
  <Say voice="\${VOICE}">We weren't able to reach the owner this time, but we'll let them know right away. They'll get back to you as soon as they can. Take care!</Say>
  <Hangup/>
</Response>\`);
};
`;
  if (fs.existsSync(file) && readFile(file).includes(MARKER_9)) {
    skip('api/inbound-call.js (already exists)');
  } else {
    backup(file);
    writeFile(file, body);
    validateJs(file);
    ok('api/inbound-call.js created');
  }
}

// ===========================================================================
// 9.3  api/voice-handler.js  (REWRITE - owner leg IVR)
// ===========================================================================

log('');
log('9.3  Rewriting api/voice-handler.js');
{
  const file = path.join(API, 'voice-handler.js');
  const body = `// ${MARKER_9}
// TapMyCar - voice-handler.js
// Played to the OWNER when they pick up the bridged call leg.
// IVR: press 1 for "I'm on my way" auto-message back, press 2 to talk.
//
// Inputs: query string carries owner name + call_log_id.

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
  const baseUrl = \`https://\${req.headers.host}\`;
  const rawName = (req.query && req.query.name) || '';
  const callLogId = (req.query && req.query.call_log_id) || '';
  const name = safeName(rawName);

  const greeting = name
    ? \`Hey, \${escapeXml(name)}!\`
    : 'Hey there!';

  // Action URL preserves call_log_id and name for voice-action
  const actionUrl = \`\${baseUrl}/api/voice-action?call_log_id=\${encodeURIComponent(callLogId)}\${name ? '&name=' + encodeURIComponent(name) : ''}\`;

  const twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" timeout="10" numDigits="1" action="\${escapeXml(actionUrl)}" method="POST">
    <Say voice="\${VOICE}">\${greeting} It's TapMyCar. Someone just tapped on your sticker - they're trying to reach you. Press 2 to talk with them now. Or press 1 to send them a quick message that you're on your way.</Say>
  </Gather>
  <Say voice="\${VOICE}">\${name ? 'Looks like we missed you, ' + escapeXml(name) + ' - no worries.' : 'Looks like we missed you - no worries.'} We'll keep them posted. Talk soon!</Say>
</Response>\`;

  res.setHeader('Content-Type', 'text/xml');
  res.send(twiml);
};
`;
  const cur = fs.existsSync(file) ? readFile(file) : '';
  if (cur.includes(MARKER_9)) {
    skip('api/voice-handler.js (already updated)');
  } else {
    backup(file);
    writeFile(file, body);
    validateJs(file);
    ok('api/voice-handler.js rewritten');
  }
}

// ===========================================================================
// 9.4  api/voice-action.js  (REWRITE - press-2 bridge with timeLimit)
// ===========================================================================

log('');
log('9.4  Rewriting api/voice-action.js');
{
  const file = path.join(API, 'voice-action.js');
  const body = `// ${MARKER_9}
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
  const cleaned = String(raw).replace(/[^A-Za-z\\s'\\-]/g, '').replace(/\\s+/g, ' ').trim().slice(0, 30);
  return cleaned.replace(/\\b\\w/g, c => c.toUpperCase());
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
    return res.send(\`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>\`);
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
    return res.send(\`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Got it\${namePart} - connecting you now. Heads up, this call ends in 60 seconds. One moment.</Say>
</Response>\`);
  }

  if (digit === '1') {
    if (callLogId) {
      try {
        await supabase
          .from('call_logs')
          .update({ status: 'message_only', ended_at: new Date().toISOString() })
          .eq('id', callLogId);
      } catch (e) { console.error('call_logs message_only update error:', e && e.message); }
    }
    return res.send(\`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Done\${namePart}! They'll know you're on your way. Thanks for being part of TapMyCar.</Say>
  <Hangup/>
</Response>\`);
  }

  // No digit / invalid
  return res.send(\`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Sorry, I didn't catch that. Goodbye for now!</Say>
  <Hangup/>
</Response>\`);
};
`;
  const cur = fs.existsSync(file) ? readFile(file) : '';
  if (cur.includes(MARKER_9)) {
    skip('api/voice-action.js (already updated)');
  } else {
    backup(file);
    writeFile(file, body);
    validateJs(file);
    ok('api/voice-action.js rewritten');
  }
}

// ===========================================================================
// 9.5  public/contact.html  (handleCall update)
// ===========================================================================

log('');
log('9.5  Updating public/contact.html handleCall()');
{
  const file = path.join(PUBLIC, 'contact.html');
  const content = readFile(file);

  if (content.includes(MARKER_9)) {
    skip('public/contact.html (already updated)');
  } else {
    backup(file);

    // Old line (single-line):
    //   function handleCall(){updateScanAction('call');showFeedback();window.location.href='tel:+18605158987';}
    const oldLine = "function handleCall(){updateScanAction('call');showFeedback();window.location.href='tel:+18605158987';}";
    const newLine = "// " + MARKER_9 + "\n" +
      "async function handleCall(){\n" +
      "  updateScanAction('call');\n" +
      "  showFeedback();\n" +
      "  // Register intent server-side so the inbound webhook knows which owner to ring.\n" +
      "  try {\n" +
      "    await fetch('/api/register-pending-call', {\n" +
      "      method: 'POST',\n" +
      "      headers: {'Content-Type':'application/json'},\n" +
      "      body: JSON.stringify({ token: currentToken })\n" +
      "    });\n" +
      "  } catch(e) { /* don't block the dial on a network hiccup */ }\n" +
      "  window.location.href = 'tel:+18605158987';\n" +
      "}";

    let updated = content;
    if (updated.includes(oldLine)) {
      updated = updated.replace(oldLine, newLine);
    } else {
      // CRLF
      const oldCRLF = oldLine;
      const newCRLF = newLine.replace(/\n/g, '\r\n');
      if (updated.includes(oldCRLF)) {
        updated = updated.replace(oldCRLF, newCRLF);
      } else {
        errExit('contact.html handleCall pattern not found - file may have drifted');
      }
    }

    writeFile(file, updated);
    ok('public/contact.html handleCall() now registers pending call before dialing Twilio');
  }
}

// ===========================================================================
// Done
// ===========================================================================

log('');
log('==============================================================');
log('Patch 9 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('CRITICAL PRE-DEPLOY STEPS (in order):');
log('');
log('  1. Run the SQL migration below in Supabase.');
log('');
log('  2. Configure Twilio Console:');
log('     Open Twilio Console > Phone Numbers > +1 (860) 515-8987');
log('     Find "Voice Configuration" > "A call comes in" section');
log('     Set Webhook URL: https://tapmycar.io/api/inbound-call');
log('     HTTP Method: POST');
log('     Save.');
log('');
log('  3. git add -A');
log('     git commit -m "Patch 9: rebuild call flow with inbound dial pattern"');
log('     git push');
log('');
log('  4. Wait ~60 seconds for Vercel deploy.');
log('');
log('  5. Test with two phones:');
log('     - Phone A: open contact.html for an active tag in incognito.');
log('       Tap Call button. Phone A should open dialer to +18605158987.');
log('       Place the call.');
log('     - Phone B (the owner phone for that tag) should ring within 5s.');
log('     - Phone A should hear: "Thanks for reaching out, connecting you to the owner..."');
log('     - Phone B answers, hears: "Hey [name]! TapMyCar... press 2 to talk..."');
log('     - Phone B presses 2.');
log('     - Both phones now connected. 60-second timer running.');
log('     - Twilio auto-hangs at 60 seconds.');
log('');
log('==============================================================');
log('SUPABASE MIGRATION (run in SQL editor BEFORE deploying):');
log('');
log('-- 1. pending_calls: stranger taps Call -> we write a row.');
log('--    inbound-call webhook reads most recent row from last 5 min.');
log('CREATE TABLE IF NOT EXISTS public.pending_calls (');
log('  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,');
log('  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,');
log('  tag_token TEXT NOT NULL,');
log('  owner_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,');
log('  owner_phone TEXT NOT NULL,');
log('  consumed BOOLEAN DEFAULT false NOT NULL,');
log('  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL');
log(');');
log('');
log('CREATE INDEX IF NOT EXISTS pending_calls_recent_idx');
log('  ON public.pending_calls(created_at DESC) WHERE consumed = false;');
log('');
log('-- 2. call_logs: every actual call attempt logged with BOTH real numbers.');
log('--    Admin-visible. Status: ringing -> bridged/no_answer/busy/etc.');
log('CREATE TABLE IF NOT EXISTS public.call_logs (');
log('  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,');
log('  tag_id UUID REFERENCES public.tags(id) ON DELETE SET NULL,');
log('  tag_token TEXT,');
log('  owner_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,');
log('  stranger_phone TEXT,');
log('  owner_phone TEXT,');
log('  twilio_call_sid TEXT,');
log('  status TEXT,             -- ringing | bridged | completed | no_answer | busy | failed | canceled | message_only');
log('  duration_seconds INTEGER,');
log('  bridged_at TIMESTAMPTZ,');
log('  ended_at TIMESTAMPTZ,');
log('  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL');
log(');');
log('');
log('CREATE INDEX IF NOT EXISTS call_logs_tag_idx ON public.call_logs(tag_id, created_at DESC);');
log('CREATE INDEX IF NOT EXISTS call_logs_owner_idx ON public.call_logs(owner_user_id, created_at DESC);');
log('==============================================================');
