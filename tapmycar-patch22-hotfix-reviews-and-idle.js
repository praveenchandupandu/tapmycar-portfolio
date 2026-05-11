// ============================================================================
// TapMyCar - Patch 22: Hotfix — get-reviews 401 errors + idle modal grammar
//
// Two small fixes:
//
// 22.1  Patch 20's badge refresh calls /api/get-reviews?status=pending&admin=X
//       but the endpoint expects admin_key=, not admin=. This causes a 401
//       every 30 seconds, flooding the console with errors. Change query
//       param to admin_key=.
//
// 22.2  Idle modal text says "You'll be signed out in 1 seconds" (bad grammar).
//       Pluralize correctly: "1 second" vs "5 seconds".
//
// REQUIRES: Patches 1-21 already applied locally.
// Properties: idempotent, backups touched files.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch22-${ts}`);

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
function tryReplace(content, oldStr, newStr) {
  if (content.includes(oldStr)) return content.replace(oldStr, newStr);
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF)) return content.replace(oldCRLF, newStr.replace(/\n/g, '\r\n'));
  return null;
}

log('');
log('TapMyCar Patch 22 \u2014 hotfix get-reviews 401 + idle grammar');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_22 = 'TMC_PATCH22_HOTFIX';

// ===========================================================================
// 22.1  admin.html — fix get-reviews query param
// ===========================================================================

log('22.1  public/admin.html: fix /api/get-reviews admin= → admin_key=');
{
  const file = path.join(PUBLIC, 'admin.html');
  const content = readFile(file);
  if (content.includes(MARKER_22)) {
    skip('admin.html (already patched)');
  } else {
    backup(file);

    // Specific to the Patch 20 badge refresh
    const oldBadgeFetch = `fetch('/api/get-reviews?status=pending&admin=' + encodeURIComponent(adminKey))`;
    const newBadgeFetch = `fetch('/api/get-reviews?status=pending&admin_key=' + encodeURIComponent(adminKey)) /* ${MARKER_22}: was admin= */`;

    let r = tryReplace(content, oldBadgeFetch, newBadgeFetch);
    if (!r) errExit('admin.html: get-reviews badge fetch anchor not found');

    writeFile(file, r);
    ok('admin.html: badge refresh now uses admin_key=');
  }
}

// ===========================================================================
// 22.2  app.js — pluralize idle modal countdown
// ===========================================================================

log('');
log('22.2  public/app.js: pluralize idle modal countdown');
{
  const file = path.join(PUBLIC, 'app.js');
  const content = readFile(file);
  if (content.includes(MARKER_22)) {
    skip('app.js (already patched)');
  } else {
    backup(file);
    let updated = content;

    // Update the tick() function to set both number AND label, with pluralization.
    // Existing pattern:
    //   var c = document.getElementById('tmc-idle-count');
    //   if (c) c.textContent = remaining;
    // We change the HTML to include a label span and update both.

    // First update the HTML — wrap "seconds" in a span we can target
    const oldHtml = `'<div style="font-size:13px;color:#6B7280;margin-bottom:18px;line-height:1.5">You&#39;ll be signed out in <span id="tmc-idle-count">60</span> seconds for inactivity.</div>'`;
    const newHtml = `'<div style="font-size:13px;color:#6B7280;margin-bottom:18px;line-height:1.5">You&#39;ll be signed out in <span id="tmc-idle-count">60</span> <span id="tmc-idle-unit">seconds</span> for inactivity.</div>' /* ${MARKER_22} */`;

    let r = tryReplace(updated, oldHtml, newHtml);
    if (!r) errExit('app.js: idle modal HTML anchor not found');
    updated = r;

    // Update tick() to set the unit label correctly
    const oldTick = `      var remaining = Math.max(0, Math.ceil((LIMIT_MS - elapsed) / 1000));
      var c = document.getElementById('tmc-idle-count');
      if (c) c.textContent = remaining;`;
    const newTick = `      var remaining = Math.max(0, Math.ceil((LIMIT_MS - elapsed) / 1000));
      var c = document.getElementById('tmc-idle-count');
      if (c) c.textContent = remaining;
      /* ${MARKER_22}: pluralize "second" vs "seconds" */
      var u = document.getElementById('tmc-idle-unit');
      if (u) u.textContent = (remaining === 1 ? 'second' : 'seconds');`;

    r = tryReplace(updated, oldTick, newTick);
    if (!r) errExit('app.js: tick() countdown anchor not found');
    updated = r;

    writeFile(file, updated);
    validateJs(file);
    ok('app.js: countdown unit pluralized');
  }
}

log('');
log('==============================================================');
log('Patch 22 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 22: hotfix get-reviews 401 + idle grammar"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('Verify:');
log('  1. Open admin.html in fresh incognito.');
log('  2. F12 > Console. Wait 60 seconds.');
log('     Should NOT see any "Failed to load resource: 401" errors on');
log('     /api/get-reviews.');
log('  3. (Optional) Wait for idle modal to appear. Countdown should say');
log('     "1 second" when remaining hits 1, not "1 seconds".');
log('==============================================================');
