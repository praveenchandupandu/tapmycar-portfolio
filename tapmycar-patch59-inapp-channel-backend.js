// ============================================================================
// TapMyCar - Patch 59 (Stage 7-a): In-app channel + optional subject (backend)
//
// PREREQUISITE
//   Patches 43-48 + 56 deployed (broadcast tool + announcement backend).
//
// THREE CHANGES requested:
//   1. "In-app popup" becomes a real CHANNEL you can send on its own. Today
//      it is only a side-effect (also_in_app flag). After this patch,
//      channels can include 'inapp', and sending ONLY 'inapp' creates the
//      announcement with NO email/push/sms. The old also_in_app flag still
//      works (treated as adding 'inapp' to the channel list), so the current
//      UI does not break before Patch 60 upgrades it.
//   2. Subject is OPTIONAL. If blank, the message still sends. The email
//      channel falls back to a default subject ('TapMyCar Update') so the
//      email is never sent with an empty subject. Push / SMS / in-app use
//      the message body and need no subject.
//   3. The "no eligible recipients" check now understands the inapp channel:
//      an in-app announcement targets every logged-in user (it is not a
//      per-recipient send), so an inapp-only broadcast is never blocked for
//      "0 recipients".
//
// WHAT THIS PATCH DOES
//   Targeted edits to api/send-broadcast.js. No SQL, no other files.
//
// Properties: idempotent (safe to re-run), validates JS, backs up the file.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch59-${ts}`);

const log  = (s) => console.log(s);
const ok   = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function writeFile(p, c) { fs.writeFileSync(p, c, { encoding: 'utf8' }); }
function backup(absPath, label) {
  if (!fs.existsSync(absPath)) return;
  const dest = path.join(BACKUP_DIR, label);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(absPath, dest);
}
function replaceOnce(src, find, replace, label) {
  const idx = src.indexOf(find);
  if (idx === -1) errExit(label + ': anchor not found - file differs from expected.');
  if (src.indexOf(find, idx + find.length) !== -1) {
    errExit(label + ': anchor matches more than once.');
  }
  return src.replace(find, function () { return replace; });
}
function checkJs(absPath, label) {
  try {
    execSync('node --check "' + absPath + '"', { stdio: 'pipe' });
    ok(label + ' passes node --check');
  } catch (e) {
    errExit(label + ' FAILED node --check:\n' + (e.stderr ? e.stderr.toString() : e.message));
  }
}

log('');
log('TapMyCar Patch 59 (Stage 7-a) - In-app channel + optional subject');
log('=================================================================');

const epPath = path.join(API, 'send-broadcast.js');
if (!fs.existsSync(epPath)) errExit('api/send-broadcast.js not found.');
let src = fs.readFileSync(epPath, 'utf8');

if (src.indexOf('TMC_PATCH59_INAPP') !== -1) {
  skip('api/send-broadcast.js');
} else {
  backup(epPath, 'api/send-broadcast.js');

  // --- EDIT 1: add 'inapp' to VALID_CHANNELS ---
  src = replaceOnce(src,
    "const VALID_CHANNELS = ['email', 'push', 'sms'];",
    "const VALID_CHANNELS = ['email', 'push', 'sms', 'inapp']; // TMC_PATCH59_INAPP",
    'Edit 1 VALID_CHANNELS');
  ok('Edit 1 - "inapp" is now a valid channel');

  // --- EDIT 2: channel normalisation - fold legacy also_in_app into channels ---
  const CH_OLD =
    "  // --- channels ---\n" +
    "  let channels = body.channels;\n" +
    "  if (!channels && body.channel) channels = [body.channel];\n" +
    "  if (!channels || !channels.length) channels = ['email'];\n" +
    "  for (const c of channels) {\n" +
    "    if (VALID_CHANNELS.indexOf(c) === -1) {\n" +
    "      return res.status(400).json({ error: 'Invalid channel: ' + c });\n" +
    "    }\n" +
    "  }\n";
  const CH_NEW =
    "  // --- channels --- (TMC_PATCH59_INAPP)\n" +
    "  let channels = body.channels;\n" +
    "  if (!channels && body.channel) channels = [body.channel];\n" +
    "  if (!channels || !channels.length) channels = ['email'];\n" +
    "  // Legacy support: the old also_in_app flag = add the 'inapp' channel.\n" +
    "  if (body.also_in_app && channels.indexOf('inapp') === -1) channels.push('inapp');\n" +
    "  for (const c of channels) {\n" +
    "    if (VALID_CHANNELS.indexOf(c) === -1) {\n" +
    "      return res.status(400).json({ error: 'Invalid channel: ' + c });\n" +
    "    }\n" +
    "  }\n";
  src = replaceOnce(src, CH_OLD, CH_NEW, 'Edit 2 channel normalisation');
  ok('Edit 2 - legacy also_in_app folds into the channel list');

  // --- EDIT 3: optional subject + inapp-aware recipient check ---
  const SEND_OLD =
    "  // --- SEND ---\n" +
    "  if (!subject || !String(subject).trim()) {\n" +
    "    return res.status(400).json({ error: 'Subject is required' });\n" +
    "  }\n" +
    "  if (!body.body || !String(body.body).trim()) {\n" +
    "    return res.status(400).json({ error: 'Message body is required' });\n" +
    "  }\n" +
    "  const totalEligible = counts.email + counts.push + counts.sms;\n" +
    "  if (totalEligible === 0) {\n" +
    "    return res.status(400).json({\n" +
    "      error: 'No eligible recipients across the selected channel(s). ' +\n" +
    "             base.length + ' user(s) matched, but none can receive on those channels.'\n" +
    "    });\n" +
    "  }\n";
  const SEND_NEW =
    "  // --- SEND --- (TMC_PATCH59_INAPP)\n" +
    "  // Subject is OPTIONAL. The message body is still required.\n" +
    "  if (!body.body || !String(body.body).trim()) {\n" +
    "    return res.status(400).json({ error: 'Please enter a message' });\n" +
    "  }\n" +
    "  // Email needs a non-empty subject line - fall back to a default if blank.\n" +
    "  const effectiveSubject = (subject && String(subject).trim())\n" +
    "    ? String(subject).trim()\n" +
    "    : 'TapMyCar Update';\n" +
    "  // In-app reaches every logged-in user, so it is not counted per-recipient.\n" +
    "  const sendsInApp = channels.indexOf('inapp') !== -1;\n" +
    "  const totalEligible = counts.email + counts.push + counts.sms;\n" +
    "  if (totalEligible === 0 && !sendsInApp) {\n" +
    "    return res.status(400).json({\n" +
    "      error: 'No eligible recipients across the selected channel(s). ' +\n" +
    "             base.length + ' user(s) matched, but none can receive on those channels.'\n" +
    "    });\n" +
    "  }\n";
  src = replaceOnce(src, SEND_OLD, SEND_NEW, 'Edit 3 optional subject');
  ok('Edit 3 - subject optional; in-app-only sends allowed');

  // --- EDIT 4: use effectiveSubject in the three channel sends ---
  src = replaceOnce(src,
    "    const r = await sendEmail(eligible.email, subject, body.body, broadcastId);",
    "    const r = await sendEmail(eligible.email, effectiveSubject, body.body, broadcastId);",
    'Edit 4a email subject');
  src = replaceOnce(src,
    "    const r = await sendPush(eligible.push, subsMap, subject, body.body, broadcastId);",
    "    const r = await sendPush(eligible.push, subsMap, effectiveSubject, body.body, broadcastId);",
    'Edit 4b push subject');
  src = replaceOnce(src,
    "    const r = await sendSms(eligible.sms, subject, body.body, broadcastId);",
    "    const r = await sendSms(eligible.sms, effectiveSubject, body.body, broadcastId);",
    'Edit 4c sms subject');
  ok('Edit 4 - channel sends use the effective (fallback-aware) subject');

  // --- EDIT 5: announcement creation - trigger on 'inapp' channel, use effectiveSubject ---
  const ANN_OLD =
    "  // TMC_PATCH56_ANNOUNCE: if the admin ticked \"Also show as in-app popup\",\n" +
    "  // save this broadcast as an in-app announcement too.\n" +
    "  let announcementCreated = false;\n" +
    "  if (body.also_in_app) {\n" +
    "    try {\n" +
    "      const { error: annErr } = await supabase.from('announcements').insert({\n" +
    "        title: String(subject), body: String(body.body),\n" +
    "        active: true, created_by: 'admin', broadcast_id: broadcastId\n" +
    "      });\n" +
    "      if (annErr) console.error('announcement insert failed:', annErr.message);\n" +
    "      else announcementCreated = true;\n" +
    "    } catch (e) { console.error('announcement insert error:', e && e.message); }\n" +
    "  }\n";
  const ANN_NEW =
    "  // TMC_PATCH59_INAPP: create the in-app announcement when the 'inapp'\n" +
    "  // channel is selected (covers both the new channel and legacy also_in_app).\n" +
    "  let announcementCreated = false;\n" +
    "  if (channels.indexOf('inapp') !== -1) {\n" +
    "    try {\n" +
    "      const { error: annErr } = await supabase.from('announcements').insert({\n" +
    "        title: effectiveSubject, body: String(body.body),\n" +
    "        active: true, created_by: 'admin', broadcast_id: broadcastId\n" +
    "      });\n" +
    "      if (annErr) console.error('announcement insert failed:', annErr.message);\n" +
    "      else announcementCreated = true;\n" +
    "    } catch (e) { console.error('announcement insert error:', e && e.message); }\n" +
    "  }\n";
  src = replaceOnce(src, ANN_OLD, ANN_NEW, 'Edit 5 announcement on inapp channel');
  ok('Edit 5 - announcement is created by the "inapp" channel');

  writeFile(epPath, src);
  checkJs(epPath, 'api/send-broadcast.js');
}

log('');
log('=================================================================');
log('Patch 59 (Stage 7-a) applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s. The UI checkbox still works; Patch 60');
log('  upgrades the UI. Pre-test from the /admin.html console:');
log('');
log('  In-app popup ONLY, NO subject:');
log('    fetch("/api/send-broadcast",{method:"POST",headers:{"Content-Type":');
log('      "application/json"},body:JSON.stringify({admin_key:adminKey,');
log('      channels:["inapp"],body:"Quick message with no subject."})})');
log('      .then(r=>r.json()).then(console.log)');
log('    -> expect success:true, announcement_created:true, and NO email.');
log('');
log('  Then I build Patch 60 - the simplified Broadcast screen with in-app');
log('  as its own channel and the subject marked optional.');
log('');
