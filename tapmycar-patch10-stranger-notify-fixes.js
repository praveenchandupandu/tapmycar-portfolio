// ============================================================================
// TapMyCar - Patch 10: Press-1 stranger notification + activity audio_url +
//                      email-subject mojibake fix
//
// Three fixes:
//
// 10.1  voice-action.js — when owner presses 1, place an outbound call to
//       stranger with the "owner is on the way" message. Currently the
//       owner press-1 hangs up the owner leg with no signal to the
//       stranger, so the stranger just hears the call cut. We look up
//       call_logs by id (passed via query param) to find stranger_phone.
//
// 10.2  get-dashboard.js — the user-path scan_logs query (line ~255) was
//       missing audio_url. Add it so activity.html can render voice memos.
//
// 10.3  notify-owner.js — line 54 had UTF-8 mojibake in the email subject:
//       'Alert: "X" â€" someone scanned...' should be 'Alert: "X" -
//       someone scanned...'. Replace mojibake with plain ASCII dash.
//
// NOT in this patch:
//   - Email-to-spam fix. This is a DNS / Resend domain verification issue,
//     not a code fix. Instructions printed at end of run.
//
// REQUIRES: Patches 1-9 already applied locally.
//
// Properties:
//   - Idempotent
//   - Backups every touched file to backup-patch10-{timestamp}/
//   - Validates JS syntax with node --check
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch10-stranger-notify-fixes.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch10-stranger-notify-fixes.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch10-stranger-notify-fixes.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch10-${ts}`);

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
log('TapMyCar Patch 10 \u2014 Press-1 notify + audio_url + mojibake fix');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_10 = 'TMC_PATCH10';

// ===========================================================================
// 10.1  voice-action.js — press-1 places outbound call to stranger
// ===========================================================================

log('10.1  voice-action.js: press-1 now notifies stranger');
{
  const file = path.join(API, 'voice-action.js');
  const content = readFile(file);

  if (content.includes(MARKER_10)) {
    skip('voice-action.js (already updated)');
  } else {
    backup(file);

    // Replace the digit==='1' block. The current block just plays a
    // confirmation to the owner. The new block ALSO looks up call_log
    // to get stranger_phone, then places an outbound Twilio call to
    // the stranger with the goodbye message.
    //
    // We use fire-and-forget for the outbound call so we don't hold up
    // the TwiML response. If it fails we log; the owner still hears
    // the confirmation.

    const oldBlock = `  if (digit === '1') {
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
  }`;

    const newBlock = `  if (digit === '1') {
    // ${MARKER_10}: notify stranger via outbound Twilio call before
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
          twiml: \`<Response><Say voice="\${VOICE}">Great news! The owner got your message and is on their way to the car right now. Thanks so much for using TapMyCar - you really helped out today!</Say></Response>\`
        }).catch(err => console.error('press-1 stranger call error:', err && err.message));
      } catch (e) { console.error('press-1 twilio init error:', e && e.message); }
    }

    return res.send(\`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="\${VOICE}">Done\${namePart}! They'll know you're on your way. Thanks for being part of TapMyCar.</Say>
  <Hangup/>
</Response>\`);
  }`;

    if (!content.includes(oldBlock)) {
      // Try CRLF
      const oldCRLF = oldBlock.replace(/\n/g, '\r\n');
      if (content.includes(oldCRLF)) {
        const newCRLF = newBlock.replace(/\n/g, '\r\n');
        writeFile(file, content.replace(oldCRLF, newCRLF));
      } else {
        errExit('voice-action.js: digit===1 block not found, manual review needed');
      }
    } else {
      writeFile(file, content.replace(oldBlock, newBlock));
    }
    validateJs(file);
    ok('voice-action.js: press-1 now places outbound call to stranger');
  }
}

// ===========================================================================
// 10.2  get-dashboard.js — add audio_url to user-path scan_logs select
// ===========================================================================

log('');
log('10.2  get-dashboard.js: add audio_url to scan_logs query');
{
  const file = path.join(API, 'get-dashboard.js');
  const content = readFile(file);

  const oldSelect = `'id, tag_id, action, contact_action, scanned_at, device_type, latitude, longitude, message_text, photo_url'`;
  const newSelect = `'id, tag_id, action, contact_action, scanned_at, device_type, latitude, longitude, message_text, photo_url, audio_url' /* ${MARKER_10} */`;

  if (content.includes(MARKER_10) || content.includes('audio_url')) {
    skip('get-dashboard.js (audio_url already in select)');
  } else if (!content.includes(oldSelect)) {
    errExit('get-dashboard.js: scan_logs select pattern not found');
  } else {
    backup(file);
    writeFile(file, content.replace(oldSelect, newSelect));
    validateJs(file);
    ok('get-dashboard.js: audio_url now returned in recentScans');
  }
}

// ===========================================================================
// 10.3  notify-owner.js — fix mojibake em-dash in email subject
// ===========================================================================

log('');
log('10.3  notify-owner.js: fix mojibake in email subject');
{
  const file = path.join(API, 'notify-owner.js');
  const content = readFile(file);

  // The bad bytes: â€" — UTF-8 bytes E2 80 94 misread as Windows-1252
  // We replace with plain ASCII " - " for safe display in all clients.
  const oldSubject = 'subject = `Alert: "${message}" \u00e2\u20ac\u201d someone scanned your TapMyCar tag`;';
  const newSubject = 'subject = `Alert: "${message}" - someone scanned your TapMyCar tag`; /* ' + MARKER_10 + ' */';

  if (content.includes(MARKER_10)) {
    skip('notify-owner.js (mojibake already fixed)');
  } else if (content.includes(oldSubject)) {
    backup(file);
    writeFile(file, content.replace(oldSubject, newSubject));
    validateJs(file);
    ok('notify-owner.js: mojibake replaced with ASCII dash');
  } else {
    // Try a more lenient match in case the bytes encode differently
    // when read by Node. Use a regex on the subject pattern.
    const re = /subject = `Alert: "\$\{message\}" .{1,5} someone scanned your TapMyCar tag`;/;
    const match = content.match(re);
    if (match) {
      backup(file);
      writeFile(file, content.replace(match[0], 'subject = `Alert: "${message}" - someone scanned your TapMyCar tag`; /* ' + MARKER_10 + ' */'));
      validateJs(file);
      ok('notify-owner.js: mojibake replaced (matched via regex fallback)');
    } else {
      log('  ! notify-owner.js: subject pattern not found, may already be ASCII or have different format');
    }
  }
}

// ===========================================================================
// Done
// ===========================================================================

log('');
log('==============================================================');
log('Patch 10 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Next steps:');
log('  git add -A');
log('  git commit -m "Patch 10: press-1 notify stranger + audio_url + email subject"');
log('  git push');
log('  Wait ~60 seconds for Vercel deploy.');
log('');
log('Test:');
log('  1. Make a test call. Owner presses 1.');
log('     - Owner hears: "Done! They will know you are on your way..."');
log('     - Owner leg hangs up.');
log('     - Within 5 seconds, STRANGER phone gets a NEW incoming call');
log('       from your Twilio number with the "owner on the way" voice.');
log('  2. Stranger sends a message via contact.html.');
log('     - Owner email arrives with subject "Alert: ... - someone scanned..."');
log('       (no more mojibake)');
log('  3. Open activity.html as the owner.');
log('     - Photo, message, and voice memo (with playable audio) all show.');
log('');
log('==============================================================');
log('PROBLEM 4 — EMAILS GOING TO SPAM');
log('==============================================================');
log('');
log('This is NOT a code issue. It is an email-deliverability problem.');
log('To fix it, you need to configure DNS records on tapmycar.io so');
log('Resend can send emails authenticated by your domain.');
log('');
log('Steps:');
log('');
log('1. Open Resend dashboard: https://resend.com/domains');
log('   (log in with the same account you use for RESEND_API_KEY)');
log('');
log('2. Click "Add Domain", enter: tapmycar.io');
log('');
log('3. Resend will show you 4-5 DNS records to add (SPF, DKIM, DMARC,');
log('   maybe MX for return path). Each will look like:');
log('     Type: TXT  Name: send  Value: v=spf1 include:_spf.resend.com -all');
log('     Type: CNAME Name: resend._domainkey  Value: ...');
log('     Type: TXT  Name: _dmarc  Value: v=DMARC1; p=none; ...');
log('');
log('4. Add those exact records to your domain registrar (Namecheap,');
log('   Cloudflare, GoDaddy, wherever you bought tapmycar.io).');
log('');
log('5. Back in Resend, click "Verify Domain". Records may take 5-60');
log('   minutes to propagate.');
log('');
log('6. Once verified (green check), your emails will:');
log('   - Be signed with DKIM (proves they came from your domain)');
log('   - Pass SPF (proves Resend is authorized to send for you)');
log('   - Pass DMARC (instructs receivers what to do with unauth mail)');
log('');
log('   Result: emails land in INBOX, not spam, for most providers.');
log('');
log('7. Build sender reputation: don\'t send bursts of identical email,');
log('   keep bounce rate low, ask early users to mark "Not spam" if');
log('   any do land in spam during the first week.');
log('');
log('There is no code patch that fixes this. The deliverability comes');
log('from your domain authentication and sending reputation.');
log('==============================================================');
