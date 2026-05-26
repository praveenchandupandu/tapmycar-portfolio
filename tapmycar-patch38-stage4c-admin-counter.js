/* ============================================================================
 * TapMyCar  Patch 38  Stage 4c  admin session-migration counter
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch38-stage4c-admin-counter.js
 *
 * Adds a small "Session migration" card to the admin Home view showing how
 * many users are on a signed session token vs the legacy UUID. The data is
 * already present — get-dashboard's admin mode does select('*'), so each
 * user object already carries last_token_type (written by the Stage 4a/4b
 * endpoints). This patch only COUNTS and DISPLAYS it.
 *
 * Two edits to public/admin.html:
 *   1. Defines tmcRenderTokenMigration() + tmcStatCell() (before
 *      renderDashboard).
 *   2. Calls tmcRenderTokenMigration(data.users) from renderDashboard,
 *      right after renderHome(data).
 *
 * Purely additive — it self-inserts a card before #home-feed and touches no
 * existing logic. Once "Legacy" stays at 0 for ~2 weeks, Stage 5 (dropping
 * the legacy fallback) is safe.
 *
 * SAFE TO RE-RUN: skipped if admin.html already contains TMC_PATCH38S4C.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FILE = path.join('public', 'admin.html');
const MARKER = 'TMC_PATCH38S4C';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = path.join('backup-patch38s4c-' + STAMP, 'public');

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* ---- the injected JS (CRLF, to match admin.html) ----------------------- */
const FUNCS = [
  "/* TMC_PATCH38S4C: session-migration counter. Counts users by",
  "   last_token_type (written by the Patch 38 Stage 4 endpoints) so we can",
  "   see when every active session has moved off the legacy UUID onto a",
  "   signed token. Stage 5 (dropping the legacy fallback) is safe once",
  "   Legacy stays at 0. */",
  "function tmcStatCell(label, num, color) {",
  "  return '<div style=\"flex:1;min-width:88px;padding:10px 12px;border-radius:10px;'",
  "    + 'background:rgba(0,0,0,0.25)\">'",
  "    + '<div style=\"font-size:22px;font-weight:800;color:' + color + '\">' + num + '</div>'",
  "    + '<div style=\"font-size:10px;font-weight:600;color:#94A3B8;'",
  "    + 'text-transform:uppercase;letter-spacing:.04em;margin-top:2px\">' + label + '</div></div>';",
  "}",
  "function tmcRenderTokenMigration(users) {",
  "  users = users || [];",
  "  var signed = 0, legacy = 0, none = 0;",
  "  for (var i = 0; i < users.length; i++) {",
  "    var t = users[i] && users[i].last_token_type;",
  "    if (t === 'signed') signed++;",
  "    else if (t === 'legacy') legacy++;",
  "    else none++;",
  "  }",
  "  var box = document.getElementById('tmc-token-migration');",
  "  if (!box) {",
  "    box = document.createElement('div');",
  "    box.id = 'tmc-token-migration';",
  "    box.style.cssText = 'margin:14px 0;padding:16px;border-radius:14px;'",
  "      + 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);'",
  "      + 'font-family:Inter,system-ui,sans-serif';",
  "    var anchor = document.getElementById('home-feed');",
  "    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor);",
  "    else document.body.appendChild(box);",
  "  }",
  "  var ok = (legacy === 0);",
  "  var msg = ok",
  "    ? 'All active sessions are on signed tokens. Dropping the legacy fallback (Patch 38 Stage 5) is safe once this has held for ~2 weeks.'",
  "    : legacy + ' session(s) still using the legacy UUID token. Those users need to sign out and back in to migrate.';",
  "  box.innerHTML =",
  "    '<div style=\"font-size:13px;font-weight:800;color:#E2E8F0\">Session migration</div>'",
  "    + '<div style=\"font-size:11px;color:#64748B;margin:2px 0 12px\">'",
  "    + 'Patch 38: legacy UUID vs signed session token, by user</div>'",
  "    + '<div style=\"display:flex;gap:9px;flex-wrap:wrap\">'",
  "    + tmcStatCell('Signed', signed, '#22C55E')",
  "    + tmcStatCell('Legacy', legacy, ok ? '#64748B' : '#F59E0B')",
  "    + tmcStatCell('No activity yet', none, '#64748B')",
  "    + '</div>'",
  "    + '<div style=\"margin-top:11px;font-size:11px;line-height:1.5;color:'",
  "    + (ok ? '#22C55E' : '#F59E0B') + '\">' + msg + '</div>';",
  "}"
].join('\r\n');

const EDITS = [
  { label: 'define tmcRenderTokenMigration + tmcStatCell',
    find:    "function renderDashboard(data) {",
    replace: FUNCS + "\r\n\r\nfunction renderDashboard(data) {" },

  { label: 'call counter from renderDashboard',
    find:    "renderHome(data);",
    replace: "renderHome(data); tmcRenderTokenMigration(data.users); /* TMC_PATCH38S4C */" }
];

/* ========================================================================
 * DRIVER
 * ======================================================================*/
log('\nTapMyCar  Patch 38 Stage 4c  admin session-migration counter');
log('Backup -> ' + BACKUP_DIR + '\n');

if (!fs.existsSync(FILE)) {
  fail('expected file not found: ' + FILE
    + '  (run from the project root containing public/)');
}

const original = fs.readFileSync(FILE, 'utf8');

if (original.indexOf(MARKER) !== -1) {
  log(FILE + ': skip (already patched)\n');
  process.exit(0);
}

let updated = original;
for (const edit of EDITS) {
  const first = updated.indexOf(edit.find);
  if (first === -1) {
    fail('pattern NOT FOUND ["' + edit.label + '"]. '
      + 'The file may have changed. Nothing was written.');
  }
  if (updated.indexOf(edit.find, first + 1) !== -1) {
    fail('pattern found MORE THAN ONCE ["' + edit.label + '"]. '
      + 'Aborting. Nothing was written.');
  }
  updated = updated.replace(edit.find, function () { return edit.replace; });
  log('   - applied: ' + edit.label);
}

/* sanity: both pieces must now be present */
if (updated.indexOf('function tmcRenderTokenMigration(users) {') === -1 ||
    updated.indexOf('tmcRenderTokenMigration(data.users);') === -1) {
  fail('post-edit sanity check failed. Nothing was written.');
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.copyFileSync(FILE, path.join(BACKUP_DIR, path.basename(FILE)));
fs.writeFileSync(FILE, updated, 'utf8');
log('   - written + backed up');

log('\nDone. admin.html patched (2 edits).\n');
log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 38 Stage 4c: admin session-migration counter"');
log('  3. git push   (wait ~60s for Vercel)');
log('  4. Open the admin panel, Home tab  the "Session migration" card');
log('     appears above the activity feed.\n');
