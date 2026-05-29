/* ============================================================================
 * TapMyCar  Patch 42c  show exit comments + CRLF cleanup
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch42c-show-comments.js
 *
 * Adds the "Recent exits" view you asked for to the admin Retention tab.
 * Each exit shows date, plan at exit, account age, the reason picked, and
 * the free-text comment (if any). Data is anonymised — there is no user_id
 * or email kept against an exit, by design, so this list shows the patterns
 * without keeping personally-identifying records of deleted users.
 *
 * Two files modified:
 *
 *   1. api/get-retention-stats.js
 *      Returns the full exit_reasons rows (last 50, last 90 days) so the
 *      admin tab can render the recent comments. Aggregate counts are
 *      unchanged.
 *
 *   2. public/cmshaveaccesstouser2026-npmevy.html
 *      - Adds a "Recent exits (last 90 days)" section to the panel.
 *      - Adds renderRecent() and wires it into the existing load() flow.
 *      - One-time cleanup: 75 \r\r\n sequences (left over from Patch 42's
 *        replacements) are normalised back to \r\n. Browsers tolerate the
 *        corrupted endings, but they get worse with each subsequent edit,
 *        so it's fixed now while we're touching the file anyway.
 *
 * SAFE TO RE-RUN: skipped if files already contain TMC_PATCH42C.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH42C';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch42c-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* ========================================================================
 * EDIT 1  api/get-retention-stats.js  — return recent_exits in the payload
 * ======================================================================*/

const RET = path.join('api', 'get-retention-stats.js');

const RET_QUERY_FIND = [
  "    /* TMC_PATCH42B: read from the dedicated exit_reasons table (which",
  "       survives user deletion), grouped client-side. Volumes are small;",
  "       fetching rows and counting in JS is fine. */",
  "    const { data: exits } = await supabase",
  "      .from('exit_reasons')",
  "      .select('reason_code')",
  "      .gte('created_at', ninetyDays);",
  "    const exit_reasons = {};",
  "    (exits || []).forEach(r => {",
  "      const k = r.reason_code || 'unknown';",
  "      exit_reasons[k] = (exit_reasons[k] || 0) + 1;",
  "    });"
].join('\n');

const RET_QUERY_REPLACE = [
  "    /* TMC_PATCH42C: also return the recent rows (anonymised) so the",
  "       Retention tab can show individual comments. Order newest-first,",
  "       cap at 500 for the aggregate count, surface the first 50 as the",
  "       recent list. The exit_reasons table has no PII — there is no",
  "       user_id, email, or phone on it. */",
  "    const { data: exits } = await supabase",
  "      .from('exit_reasons')",
  "      .select('reason_code, reason_text, plan_at_exit, account_age_days, consent_given, created_at')",
  "      .gte('created_at', ninetyDays)",
  "      .order('created_at', { ascending: false })",
  "      .limit(500);",
  "    const exit_reasons = {};",
  "    (exits || []).forEach(r => {",
  "      const k = r.reason_code || 'unknown';",
  "      exit_reasons[k] = (exit_reasons[k] || 0) + 1;",
  "    });",
  "    const recent_exits = (exits || []).slice(0, 50);"
].join('\n');

const RET_RESP_FIND = [
  "    return res.json({",
  "      ok: true,",
  "      exit_reasons,",
  "      exit_total_90d: (exits || []).length,",
  "      marketing_consented: opted_in || 0,",
  "      lapsed_emails_sent_30d: lapsed_30d || 0",
  "    });"
].join('\n');

const RET_RESP_REPLACE = [
  "    return res.json({",
  "      ok: true,",
  "      exit_reasons,",
  "      exit_total_90d: (exits || []).length,",
  "      marketing_consented: opted_in || 0,",
  "      lapsed_emails_sent_30d: lapsed_30d || 0,",
  "      recent_exits  /* TMC_PATCH42C */",
  "    });"
].join('\n');

/* ========================================================================
 * EDIT 2  admin HTML  — Recent exits section + renderRecent + wiring
 * ======================================================================*/

const ADMIN = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');

/* 2a — panel: add the Recent exits section right after "Why users are leaving" */
const PANEL_FIND = [
  "          <div id=\"ret-reasons\"><div class=\"empty\">Loading…</div></div>",
  "        </div>"
].join('\n');

const PANEL_REPLACE = [
  "          <div id=\"ret-reasons\"><div class=\"empty\">Loading…</div></div>",
  "        </div>",
  "        <div style=\"margin-top:18px\"><!-- TMC_PATCH42C -->",
  "          <div style=\"font-weight:800;font-size:14px;margin-bottom:10px\">Recent exits (last 90 days)</div>",
  "          <div id=\"ret-recent\"><div class=\"empty\">Loading…</div></div>",
  "        </div>"
].join('\n');

/* 2b — insert renderRecent helpers before load() */
const HELPERS_FIND =
  "  function load() {\n    var stats = document.getElementById('ret-stats');";

const HELPERS_REPLACE = [
  "  /* TMC_PATCH42C: recent-exits rendering helpers */",
  "  function fmtDate(iso) {",
  "    try { return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric' }); }",
  "    catch (e) { return ''; }",
  "  }",
  "  function planLabel(p) {",
  "    var L = { etag: 'Free (eTag)', standard: 'Standard', premium: 'Premium' };",
  "    return L[p] || (p || 'unknown');",
  "  }",
  "  function renderRecent(rows) {",
  "    if (!rows || !rows.length) return '<div class=\"empty\">No exits captured yet.</div>';",
  "    return rows.map(function (r) {",
  "      var dt = fmtDate(r.created_at);",
  "      var pl = planLabel(r.plan_at_exit);",
  "      var age = (r.account_age_days != null) ? (r.account_age_days + ' days old') : '';",
  "      var meta = [dt, pl, age].filter(Boolean).join(' · ');",
  "      var label = LABEL[r.reason_code] || r.reason_code || 'Unknown';",
  "      var comment = r.reason_text ? escHTML(r.reason_text) : '';",
  "      var consent = r.consent_given",
  "        ? '<span style=\"font-size:10px;color:#22C55E;background:rgba(34,197,94,0.12);padding:2px 8px;border-radius:6px;margin-left:8px\">opted in</span>'",
  "        : '';",
  "      return '<div style=\"padding:12px 14px;background:rgba(0,0,0,0.25);border-radius:10px;margin-bottom:8px\">' +",
  "        '<div style=\"font-size:11px;color:#94A3B8;margin-bottom:4px\">' + escHTML(meta) + consent + '</div>' +",
  "        '<div style=\"font-size:13px;font-weight:700;color:#E2E8F0;margin-bottom:' + (comment ? '6' : '0') + 'px\">' + escHTML(label) + '</div>' +",
  "        (comment ? ('<div style=\"font-size:12px;color:#CBD5E1;line-height:1.55;font-style:italic;border-left:2px solid #475569;padding-left:10px;margin-top:4px\">' + comment + '</div>') : '') +",
  "      '</div>';",
  "    }).join('');",
  "  }",
  "  function load() {",
  "    var stats = document.getElementById('ret-stats');"
].join('\n');

/* 2c — load() error branch: also clear ret-recent */
const ERR_FIND = [
  "      if (!d || !d.ok) {",
  "        stats.innerHTML = '<div class=\"empty\">Could not load stats.</div>';",
  "        reasons.innerHTML = '';",
  "        return;",
  "      }"
].join('\n');

const ERR_REPLACE = [
  "      if (!d || !d.ok) {",
  "        stats.innerHTML = '<div class=\"empty\">Could not load stats.</div>';",
  "        reasons.innerHTML = '';",
  "        var recentEl = document.getElementById('ret-recent');",
  "        if (recentEl) recentEl.innerHTML = ''; /* TMC_PATCH42C */",
  "        return;",
  "      }"
].join('\n');

/* 2d — success branch: populate ret-recent */
const SUCCESS_FIND = [
  "      reasons.innerHTML = renderReasons(d.exit_reasons, d.exit_total_90d);",
  "    }).catch(function () {",
  "      stats.innerHTML = '<div class=\"empty\">Network error.</div>';",
  "      reasons.innerHTML = '';",
  "    });"
].join('\n');

const SUCCESS_REPLACE = [
  "      reasons.innerHTML = renderReasons(d.exit_reasons, d.exit_total_90d);",
  "      var recentEl = document.getElementById('ret-recent'); /* TMC_PATCH42C */",
  "      if (recentEl) recentEl.innerHTML = renderRecent(d.recent_exits || []);",
  "    }).catch(function () {",
  "      stats.innerHTML = '<div class=\"empty\">Network error.</div>';",
  "      reasons.innerHTML = '';",
  "      var recentElErr = document.getElementById('ret-recent'); /* TMC_PATCH42C */",
  "      if (recentElErr) recentElErr.innerHTML = '';",
  "    });"
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 42c  recent exits view + CRLF cleanup');
log('Backup -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

/* ---- File 1: get-retention-stats.js ----------------------------------- */
function patchRetention() {
  if (!fs.existsSync(RET)) fail('expected file not found: ' + RET);
  const original = fs.readFileSync(RET, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(RET + ': skip (already patched)');
    return false;
  }
  const wasCRLF = original.indexOf('\r\n') !== -1;
  let updated = original.replace(/\r\n/g, '\n');

  const edits = [
    { label: 'extend exit query',     find: RET_QUERY_FIND, replace: RET_QUERY_REPLACE },
    { label: 'add recent_exits to response', find: RET_RESP_FIND,  replace: RET_RESP_REPLACE }
  ];
  for (const e of edits) {
    const i = updated.indexOf(e.find);
    if (i === -1) fail('pattern NOT FOUND in ' + RET + '  [' + e.label + ']');
    if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE in ' + RET);
    updated = updated.replace(e.find, () => e.replace);
  }
  if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');

  backupAndWrite(RET, original, updated);
  execSync('node --check "' + RET + '"', { stdio: 'pipe' });
  log(RET + ': patched, node --check OK');
  return true;
}

/* ---- File 2: admin HTML (with CRLF cleanup pre-pass) ------------------ */
function patchAdmin() {
  if (!fs.existsSync(ADMIN)) fail('expected file not found: ' + ADMIN);
  const original = fs.readFileSync(ADMIN, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(ADMIN + ': skip (already patched)');
    return false;
  }

  /* CLEANUP PRE-PASS: normalise \r\r\n -> \r\n (caused by Patch 42's
     replacements inserting \r\n inside a CRLF file that the driver then
     CRLF-restored). Browsers tolerate but each subsequent edit can double
     it again, so fix at byte level. */
  const before = (original.match(/\r\r\n/g) || []).length;
  let cleaned = original.replace(/\r\r\n/g, '\r\n');
  /* also strip any lone \r not followed by \n, just in case */
  cleaned = cleaned.replace(/\r(?!\n)/g, '');
  const after = (cleaned.match(/\r\r\n/g) || []).length;
  if (before > 0) log('   - cleanup: normalised ' + before + ' \\r\\r\\n sequences');

  /* Then normal LF normalisation for the find/replace edits */
  const wasCRLF = cleaned.indexOf('\r\n') !== -1;
  let updated = cleaned.replace(/\r\n/g, '\n');

  const edits = [
    { label: 'panel: Recent exits section', find: PANEL_FIND,   replace: PANEL_REPLACE },
    { label: 'helpers: renderRecent before load', find: HELPERS_FIND, replace: HELPERS_REPLACE },
    { label: 'load: error branch clears ret-recent', find: ERR_FIND, replace: ERR_REPLACE },
    { label: 'load: success+catch populate/clear ret-recent', find: SUCCESS_FIND, replace: SUCCESS_REPLACE }
  ];
  for (const e of edits) {
    const i = updated.indexOf(e.find);
    if (i === -1) fail('pattern NOT FOUND in ' + ADMIN + '  [' + e.label + ']');
    if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE in ' + ADMIN + '  [' + e.label + ']');
    updated = updated.replace(e.find, () => e.replace);
  }
  if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');

  /* Sanity: confirm no \r\r\n remained */
  const finalDoubled = (updated.match(/\r\r\n/g) || []).length;
  if (finalDoubled > 0) fail('post-edit: ' + finalDoubled + ' \\r\\r\\n still present');

  backupAndWrite(ADMIN, original, updated);

  /* Syntax-check the script block around our new helpers */
  const i = updated.indexOf('TMC_PATCH42C: recent-exits rendering helpers');
  const a = updated.lastIndexOf('<script>', i) + 8;
  const b = updated.indexOf('</script>', i);
  fs.writeFileSync('/tmp/p42c-chk.js', updated.slice(a, b));
  execSync('node --check /tmp/p42c-chk.js', { stdio: 'pipe' });
  log(ADMIN + ': patched, embedded JS node --check OK');
  return true;
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
let changed = 0;
try {
  if (patchRetention()) changed++;
  if (patchAdmin())     changed++;
} catch (e) {
  fail(e && e.message);
}

log('');
if (changed === 0) {
  log('All files already patched. Nothing to do.');
} else {
  log('Done. Files changed: ' + changed + '\n');
  log('NEXT STEPS:');
  log('  1. git add -A');
  log('  2. git commit -m "Patch 42c: show exit comments in Retention tab"');
  log('  3. git push  (wait ~60s for Vercel)');
  log('  4. Hard-refresh admin (Ctrl+Shift+R), open Retention tab.');
  log('     Existing exit (Too expensive) should show as a card. New');
  log('     deletions will appear with their comments below it.\n');
}
