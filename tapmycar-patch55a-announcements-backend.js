/* ============================================================================
 * TapMyCar  Patch 55a  announcements backend (date window + audience)
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch55a-announcements-backend.js
 *
 * Two backend changes:
 *
 *   1. api/get-announcement.js  filter by date window and audience.
 *      - Skip announcements outside [start_date, end_date]
 *      - For audience='existing', skip if user.created_at >= announcement.created_at
 *      - Existing behavior preserved: still returns newest unseen first
 *
 *   2. api/seen-announcement.js  log when an upsert fails so we can
 *      diagnose the dismiss-not-recording bug. The migration adds the
 *      unique index that almost certainly fixes the underlying issue,
 *      but the log helps confirm.
 *
 * No admin UI yet  that's Patch 55b. After deploying 55a, existing test
 * announcements will start auto-expiring 14 days after their created_at",
 * (backfilled by the migration). New announcements will need start_date /",
 * end_date / audience  Patch 55b adds the UI for that.",
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH55A.",
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH55A';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch55a-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const GA = path.join('api', 'get-announcement.js');
const SA = path.join('api', 'seen-announcement.js');

/* ========================================================================
 * EDIT 1  get-announcement.js  full rewrite of the SELECT + filter logic
 * ----------------------------------------------------------------------
 * Replace the whole module body. It's small enough and the change is
 * pervasive (need to also lookup user.created_at), so a clean rewrite is
 * safer than surgical patching.
 * ======================================================================*/

const GA_BODY = [
  "// TMC_PATCH55A announcement popup endpoint.",
  "// Returns the newest active announcement the user has NOT dismissed AND",
  "// that matches: now() in [start_date, end_date] AND audience matches user.",
  "// Accepts GET (?user_id=) or POST { user_id }.",
  "",
  "const { createClient } = require('@supabase/supabase-js');",
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);",
  "",
  "module.exports = async function handler(req, res) {",
  "  const user_id = (req.method === 'POST' ? (req.body && req.body.user_id)",
  "                                         : (req.query && req.query.user_id));",
  "  if (!user_id) return res.status(400).json({ error: 'user_id required' });",
  "",
  "  /* Look up the user's created_at so we can apply audience filtering. */",
  "  const { data: user, error: userErr } = await supabase",
  "    .from('users')",
  "    .select('id, created_at')",
  "    .eq('id', String(user_id))",
  "    .single();",
  "  if (userErr || !user) {",
  "    /* If user not found, no announcement is appropriate. Fail closed. */",
  "    return res.json({ success: true, announcement: null });",
  "  }",
  "",
  "  const nowIso = new Date().toISOString();",
  "",
  "  /* Pull candidate announcements: active, within date window. We do the",
  "     audience check in JS because it depends on per-announcement created_at",
  "     vs. user.created_at  cleaner than two queries. */",
  "  const { data: anns, error } = await supabase",
  "    .from('announcements')",
  "    .select('id, title, body, created_at, start_date, end_date, audience')",
  "    .eq('active', true)",
  "    .lte('start_date', nowIso)",
  "    .gte('end_date',   nowIso)",
  "    .order('created_at', { ascending: false })",
  "    .limit(20);",
  "  if (error) return res.status(500).json({ error: error.message });",
  "  if (!anns || !anns.length) return res.json({ success: true, announcement: null });",
  "",
  "  /* Apply audience filter:",
  "       'all'      always passes",
  "       'existing' user must have existed BEFORE the announcement was created */",
  "  const userCreatedMs = user.created_at ? new Date(user.created_at).getTime() : 0;",
  "  const eligible = anns.filter(function (a) {",
  "    const aud = a.audience || 'all';",
  "    if (aud === 'all') return true;",
  "    if (aud === 'existing') {",
  "      if (!a.created_at) return false;",
  "      return userCreatedMs > 0 && userCreatedMs < new Date(a.created_at).getTime();",
  "    }",
  "    return false; /* unknown audience values are ignored */",
  "  });",
  "  if (!eligible.length) return res.json({ success: true, announcement: null });",
  "",
  "  /* Dismiss lookup. */",
  "  const ids = eligible.map(function (a) { return a.id; });",
  "  const { data: seen } = await supabase",
  "    .from('announcement_seen')",
  "    .select('announcement_id')",
  "    .eq('user_id', String(user_id))",
  "    .in('announcement_id', ids);",
  "  const seenSet = {};",
  "  (seen || []).forEach(function (s) { seenSet[s.announcement_id] = true; });",
  "",
  "  const next = eligible.find(function (a) { return !seenSet[a.id]; });",
  "  return res.json({ success: true, announcement: next || null });",
  "};",
  ""
].join('\n');

/* ========================================================================
 * EDIT 2  seen-announcement.js  better error logging
 * ======================================================================*/

const SA_FIND = [
  "  const { error } = await supabase",
  "    .from('announcement_seen')",
  "    .upsert(",
  "      { user_id: String(user_id), announcement_id: announcement_id },",
  "      { onConflict: 'announcement_id,user_id' }",
  "    );",
  "  if (error) {",
  "    console.error('seen-announcement error:', error.message);",
  "    return res.status(500).json({ error: error.message });",
  "  }",
  "  return res.json({ success: true });",
  "};"
].join('\n');

const SA_REPLACE = [
  "  /* TMC_PATCH55A: with the unique index added in the migration, this",
  "     upsert now actually de-dupes via the onConflict clause. Before the",
  "     index existed, this call may have been failing silently or partially. */",
  "  const { error } = await supabase",
  "    .from('announcement_seen')",
  "    .upsert(",
  "      { user_id: String(user_id), announcement_id: announcement_id },",
  "      { onConflict: 'announcement_id,user_id' }",
  "    );",
  "  if (error) {",
  "    console.error('TMC_PATCH55A seen-announcement upsert error:', {",
  "      user_id: String(user_id),",
  "      announcement_id: announcement_id,",
  "      message: error.message,",
  "      details: error.details,",
  "      hint: error.hint,",
  "      code: error.code",
  "    });",
  "    return res.status(500).json({ error: error.message });",
  "  }",
  "  return res.json({ success: true });",
  "};"
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 55a  announcements backend\n');
log('Backup -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
let changed = 0;

/* EDIT 1: get-announcement full rewrite */
{
  const original = fs.existsSync(GA) ? fs.readFileSync(GA, 'utf8') : '';
  if (original.indexOf(MARKER) !== -1) {
    log(GA + ': skip (already patched)');
  } else {
    if (fs.existsSync(GA)) {
      fs.mkdirSync(path.join(BACKUP_DIR, 'api'), { recursive: true });
      fs.copyFileSync(GA, path.join(BACKUP_DIR, GA));
    }
    fs.writeFileSync(GA, GA_BODY, 'utf8');
    try {
      execSync('node --check "' + GA + '"', { stdio: 'pipe' });
      log(GA + ': rewritten, node --check OK');
      changed++;
    } catch (e) {
      fail('node --check FAILED for ' + GA + '\n' + String(e.stderr || e.message));
    }
  }
}

/* EDIT 2: seen-announcement targeted patch */
{
  if (!fs.existsSync(SA)) fail('expected file not found: ' + SA);
  const original = fs.readFileSync(SA, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(SA + ': skip (already patched)');
  } else {
    const wasCRLF = original.indexOf('\r\n') !== -1;
    let updated = original.replace(/\r\n/g, '\n');
    const i = updated.indexOf(SA_FIND);
    if (i === -1) fail('pattern NOT FOUND in ' + SA);
    if (updated.indexOf(SA_FIND, i + 1) !== -1) fail('pattern NOT UNIQUE in ' + SA);
    updated = updated.replace(SA_FIND, () => SA_REPLACE);
    if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
    backupAndWrite(SA, original, updated);
    try {
      execSync('node --check "' + SA + '"', { stdio: 'pipe' });
      log(SA + ': patched, node --check OK');
      changed++;
    } catch (e) {
      fs.writeFileSync(SA, original, 'utf8');
      fail('node --check FAILED  file restored.\n' + String(e.stderr || e.message));
    }
  }
}

log('');
if (changed === 0) {
  log('All files already patched. Nothing to do.\n');
} else {
  log('Done. Files changed: ' + changed + '\n');
  log('IMPORTANT  REQUIRED before deploy:');
  log('  Run patch55a-migration.sql in Supabase first. It:');
  log('    - adds start_date, end_date, audience columns');
  log('    - backfills existing rows to [created_at, created_at+14 days]');
  log('      (so most of your test announcements will auto-expire)');
  log('    - adds the unique index on (announcement_id, user_id) that');
  log('      almost certainly fixes the dismiss-not-recording bug\n');
  log('NEXT STEPS:');
  log('  1. Run patch55a-migration.sql in Supabase');
  log('  2. git add -A');
  log('  3. git commit -m "Patch 55a: announcements date window + audience + dismiss fix"');
  log('  4. git push  (wait ~60s for Vercel)');
  log('  5. Hard-refresh dashboard. Most test announcements should now be');
  log('     auto-expired and no popup should appear.');
  log('  6. Optional: re-enable a test row with a fresh window to verify');
  log('     the new logic works (Patch 55b admin UI makes this easier).\n');
}
