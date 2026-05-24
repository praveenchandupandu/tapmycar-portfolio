// ============================================================================
// TapMyCar - Patch 56 (Stage 6-a): In-app announcement popup - backend
//
// PREREQUISITE
//   Run tapmycar-patch56-announcements-schema.sql in Supabase FIRST
//   (creates the announcements + announcement_seen tables).
//   Patches 43-48 deployed (the broadcast tool).
//
// WHAT THIS PATCH DOES
//   1. api/send-broadcast.js  - HOOKED. When a broadcast is sent with the new
//      flag  also_in_app: true , the patch also inserts a row into the
//      announcements table. The broadcast result then includes
//      announcement_created: true. Existing behaviour is unchanged when the
//      flag is absent.
//
//   2. api/get-announcement.js  - NEW. Public endpoint. Given a user_id, it
//      returns the newest ACTIVE announcement that the user has NOT yet
//      dismissed - or nothing if there is none. This is what the in-app
//      popup polls on page load.
//
//   3. api/seen-announcement.js - NEW. Public endpoint. POST { user_id,
//      announcement_id } records that the user dismissed that announcement,
//      so it never pops up for them again ("show once").
//
//   No vercel.json change (both new endpoints covered by /api/:path*).
//
// Properties: idempotent (safe to re-run), validates JS, backs up changes.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch56-${ts}`);

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
log('TapMyCar Patch 56 (Stage 6-a) - In-app announcement backend');
log('===========================================================');

// ----------------------------------------------------------------------------
// STEP 1 - hook api/send-broadcast.js
// ----------------------------------------------------------------------------
log('');
log('Step 1 - api/send-broadcast.js (announcement-on-broadcast hook)');

const epPath = path.join(API, 'send-broadcast.js');
if (!fs.existsSync(epPath)) errExit('api/send-broadcast.js not found - run Patches 43-48 first.');
let epSrc = fs.readFileSync(epPath, 'utf8');

if (epSrc.indexOf('TMC_PATCH56_ANNOUNCE') !== -1) {
  skip('api/send-broadcast.js');
} else {
  backup(epPath, 'api/send-broadcast.js');

  // Anchor: the final SEND return block.
  const OLD =
    "  let totalSent = 0, totalFailed = 0;\n" +
    "  Object.keys(results).forEach(function (c) {\n" +
    "    totalSent += results[c].sent; totalFailed += results[c].failed;\n" +
    "  });\n" +
    "\n" +
    "  return res.json({\n" +
    "    success: true, broadcast_id: broadcastId, channels: channels,\n" +
    "    results: results, sent: totalSent, failed: totalFailed,\n" +
    "    base: base.length, count: totalEligible\n" +
    "  });\n";

  const NEW =
    "  let totalSent = 0, totalFailed = 0;\n" +
    "  Object.keys(results).forEach(function (c) {\n" +
    "    totalSent += results[c].sent; totalFailed += results[c].failed;\n" +
    "  });\n" +
    "\n" +
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
    "  }\n" +
    "\n" +
    "  return res.json({\n" +
    "    success: true, broadcast_id: broadcastId, channels: channels,\n" +
    "    results: results, sent: totalSent, failed: totalFailed,\n" +
    "    base: base.length, count: totalEligible,\n" +
    "    announcement_created: announcementCreated\n" +
    "  });\n";

  epSrc = replaceOnce(epSrc, OLD, NEW, 'send-broadcast announcement hook');
  writeFile(epPath, epSrc);
  checkJs(epPath, 'api/send-broadcast.js');
  ok('send-broadcast.js now creates an announcement when also_in_app is set');
}

// ----------------------------------------------------------------------------
// STEP 2 - create api/get-announcement.js
// ----------------------------------------------------------------------------
log('');
log('Step 2 - api/get-announcement.js (NEW)');

const GET_ANN = String.raw`// TMC_PATCH56_ANNOUNCE - returns the newest active announcement the user
// has not yet dismissed. Used by the in-app popup. Public (user_id only).
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  // Accept GET (?user_id=) or POST { user_id }.
  const user_id = (req.method === 'POST' ? (req.body && req.body.user_id)
                                         : (req.query && req.query.user_id));
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  // Newest active announcements first.
  const { data: anns, error } = await supabase
    .from('announcements')
    .select('id, title, body, created_at')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return res.status(500).json({ error: error.message });
  if (!anns || !anns.length) return res.json({ success: true, announcement: null });

  // Which of these has this user already dismissed?
  const ids = anns.map(function (a) { return a.id; });
  const { data: seen } = await supabase
    .from('announcement_seen')
    .select('announcement_id')
    .eq('user_id', String(user_id))
    .in('announcement_id', ids);
  const seenSet = {};
  (seen || []).forEach(function (s) { seenSet[s.announcement_id] = true; });

  // First (newest) announcement not yet seen.
  const next = anns.find(function (a) { return !seenSet[a.id]; });
  return res.json({ success: true, announcement: next || null });
};
`;

const getAnnPath = path.join(API, 'get-announcement.js');
if (fs.existsSync(getAnnPath) &&
    fs.readFileSync(getAnnPath, 'utf8').indexOf('TMC_PATCH56_ANNOUNCE') !== -1) {
  skip('api/get-announcement.js');
} else {
  backup(getAnnPath, 'api/get-announcement.js');
  writeFile(getAnnPath, GET_ANN);
  checkJs(getAnnPath, 'api/get-announcement.js');
  ok('Created api/get-announcement.js');
}

// ----------------------------------------------------------------------------
// STEP 3 - create api/seen-announcement.js
// ----------------------------------------------------------------------------
log('');
log('Step 3 - api/seen-announcement.js (NEW)');

const SEEN_ANN = String.raw`// TMC_PATCH56_ANNOUNCE - records that a user dismissed an announcement,
// so it never pops up for them again. POST { user_id, announcement_id }.
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, announcement_id } = req.body || {};
  if (!user_id || !announcement_id) {
    return res.status(400).json({ error: 'user_id and announcement_id required' });
  }

  const { error } = await supabase
    .from('announcement_seen')
    .upsert(
      { user_id: String(user_id), announcement_id: announcement_id },
      { onConflict: 'announcement_id,user_id' }
    );
  if (error) {
    console.error('seen-announcement error:', error.message);
    return res.status(500).json({ error: error.message });
  }
  return res.json({ success: true });
};
`;

const seenAnnPath = path.join(API, 'seen-announcement.js');
if (fs.existsSync(seenAnnPath) &&
    fs.readFileSync(seenAnnPath, 'utf8').indexOf('TMC_PATCH56_ANNOUNCE') !== -1) {
  skip('api/seen-announcement.js');
} else {
  backup(seenAnnPath, 'api/seen-announcement.js');
  writeFile(seenAnnPath, SEEN_ANN);
  checkJs(seenAnnPath, 'api/seen-announcement.js');
  ok('Created api/seen-announcement.js');
}

// ----------------------------------------------------------------------------
// DONE
// ----------------------------------------------------------------------------
log('');
log('===========================================================');
log('Patch 56 (Stage 6-a) applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  BEFORE PUSHING: confirm tapmycar-patch56-announcements-schema.sql');
log('  has been run in Supabase.');
log('');
log('  Commit + push, wait ~60s. The popup itself comes in Patch 57; you');
log('  can pre-test the backend from the /admin.html console:');
log('');
log('  Create an announcement via a broadcast (note also_in_app:true):');
log('    fetch("/api/send-broadcast",{method:"POST",headers:{"Content-Type":');
log('      "application/json"},body:JSON.stringify({admin_key:adminKey,');
log('      channels:["email"],subject:"Test announcement",');
log('      body:"This is an in-app popup test.",also_in_app:true,');
log('      recipients:{mode:"specific",ids:["praveenchandu2828@gmail.com"]}})})');
log('      .then(r=>r.json()).then(console.log)');
log('    -> expect announcement_created: true');
log('');
log('  Then check it comes back for your user (use your tmc_token):');
log('    fetch("/api/get-announcement?user_id="+localStorage.getItem("tmc_token"))');
log('      .then(r=>r.json()).then(console.log)');
log('    -> expect { announcement: { id, title, body } }');
log('');
log('  Then I build Patch 57 - the popup + the admin checkbox.');
log('');
