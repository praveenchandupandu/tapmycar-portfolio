// ============================================================================
// TapMyCar - Patch 11: Press-1 single-call notification (no separate callback)
//
// Concept change: instead of placing a SEPARATE outbound call to the stranger
// when owner presses 1, we speak the "owner is on the way" message to the
// stranger in the SAME call, by using Twilio's <Dial action=...> callback
// which runs on the stranger leg after the owner leg ends.
//
// How it works:
//   1. Stranger calls Twilio. inbound-call.js builds <Dial action="/api/voice-action?call_log_id=X">
//   2. Owner answers, hears IVR.
//   3. Owner presses 1.
//   4. voice-action.js (running on owner leg) marks call_log status='message_only',
//      returns "Done! They'll know you're on your way..." then <Hangup/>.
//   5. Owner leg ends.
//   6. Twilio's parent <Dial> sees dial completed, fetches voice-action.js's
//      action URL (DialCallStatus webhook). This now runs on the STRANGER leg.
//   7. voice-action.js Path A looks up the call_log. If status is 'message_only',
//      it speaks the "owner on the way" message TO THE STRANGER, then hangs up.
//   8. Stranger hears the message in the SAME call. No separate outbound call.
//
// Why this is better than Patch 10:
//   - Single call (no extra Twilio charge for outbound)
//   - Stranger doesn't get a confusing second incoming call
//   - Cleaner UX: "owner answered, you got the message, call ends"
//
// What this patch removes:
//   - The fire-and-forget outbound call to stranger from Patch 10 (gone)
//   - Patch 10's added Twilio require/init code (gone)
//
// What this patch keeps:
//   - Press 2 bridge flow (untouched)
//   - All call_logs status updates (untouched)
//   - All other endpoints (untouched)
//
// REQUIRES: Patches 1-10 already applied locally.
//
// Properties:
//   - Idempotent (re-running is a no-op)
//   - Backups voice-action.js to backup-patch11-{timestamp}/
//   - Validates JS syntax with node --check
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch11-press1-single-call.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch11-press1-single-call.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch11-press1-single-call.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch11-${ts}`);

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
log('TapMyCar Patch 11 \u2014 Press-1 single-call notification');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_11 = 'TMC_PATCH11_PRESS1_SINGLE';

// ===========================================================================
// Rewrite voice-action.js entirely. Single source of truth.
// ===========================================================================

log('11.1  Rewriting api/voice-action.js (single-call press-1 flow)');

{
  const file = path.join(API, 'voice-action.js');
  const content = readFile(file);

  if (content.includes(MARKER_11)) {
    skip('voice-action.js (already patched)');
  } else {
    backup(file);

    const newBody = `// ${MARKER_11}
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
      return res.send(\`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Great news! The owner got your message and is on their way to the car right now. Thanks so much for using TapMyCar - you really helped out today!</Say>
  <Hangup/>
</Response>\`);
    }

    // Bridged or other status: just hangup quietly.
    return res.send(\`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>\`);
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

    return res.send(\`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Got it\${namePart} - connecting you now. Heads up, this call ends in 60 seconds. One moment.</Say>
</Response>\`);
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

    return res.send(\`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Done\${namePart}! They'll know you're on your way. Thanks for being part of TapMyCar.</Say>
  <Hangup/>
</Response>\`);
  }

  // No digit / invalid press
  return res.send(\`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Sorry, I didn't catch that. Goodbye for now!</Say>
  <Hangup/>
</Response>\`);
};
`;

    writeFile(file, newBody);
    validateJs(file);
    ok('voice-action.js: rewritten with single-call press-1 flow');
  }
}

log('');
log('==============================================================');
log('Patch 11 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Next steps:');
log('  git add -A');
log('  git commit -m "Patch 11: press-1 stranger notification in same call"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('Test:');
log('  Make a test call. Owner presses 1.');
log('  - Owner hears "Done! They will know you are on your way..." and hangs up.');
log('  - In the SAME call (no separate ring), stranger hears:');
log('    "Great news! The owner got your message and is on their way..."');
log('  - Stranger leg ends naturally.');
log('  - No second incoming call to the stranger phone.');
log('');
log('Also retest press-2 to confirm bridge still works:');
log('  - Owner presses 2');
log('  - Bridged for up to 60s');
log('  - Both auto-hangup at 60s');
log('==============================================================');
