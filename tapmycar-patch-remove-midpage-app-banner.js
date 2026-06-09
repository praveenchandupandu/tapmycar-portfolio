/* ============================================================================
 * TapMyCar  Patch  Remove mid-page "Get the TapMyCar App" banner
 *
 * Removes the dark mid-page <div class="app-banner"> (with shield icon,
 * "Get the TapMyCar App" heading, "Download Free" button) on landing.html
 * since the same call-to-action already exists in the footer.
 *
 * Anchored on the unique "<!-- APP DOWNLOAD BANNER -->" comment and the
 * "<!-- FEATURES -->" comment that follows  walks back to include any
 * preceding <div class="tape"></div> and whitespace.
 *
 * Idempotent: skips if TMC_NO_MIDPAGE_APP_BANNER already present.
 *
 * Run from project root:  node tapmycar-patch-remove-midpage-app-banner.js
 * Safe to re-run.
 * ==========================================================================*/
'use strict';
const fs   = require('fs');
const path = require('path');

const STAMP      = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-midpage-app-banner-' + STAMP;
const TARGET     = path.join('public', 'landing.html');

if (!fs.existsSync(TARGET)) { console.error(TARGET + ' not found.'); process.exit(1); }
let text = fs.readFileSync(TARGET, 'utf8');

if (text.indexOf('TMC_NO_MIDPAGE_APP_BANNER') !== -1) {
  console.log(TARGET + ': skip (mid-page banner already removed)');
  process.exit(0);
}

// Backup
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(path.join(BACKUP_DIR, 'public'), { recursive: true });
fs.copyFileSync(TARGET, path.join(BACKUP_DIR, TARGET));

// Normalize line endings
const wasCRLF = text.indexOf('\r\n') !== -1;
text = text.replace(/\r\n/g, '\n');

const START_ANCHOR = '<!-- APP DOWNLOAD BANNER -->';
const END_ANCHOR   = '<!-- FEATURES -->';

let start = text.indexOf(START_ANCHOR);
const end = text.indexOf(END_ANCHOR, start);
if (start < 0 || end < 0) {
  console.error('Anchors not found  no changes made.');
  process.exit(1);
}

// Walk back to swallow preceding <div class="tape"></div> if it sits right before
const tapeIdx = text.lastIndexOf('<div class="tape"></div>', start);
if (tapeIdx >= 0 && (start - tapeIdx) < 80) start = tapeIdx;
// Walk back further over whitespace
while (start > 0 && /[ \t\n]/.test(text[start - 1])) start--;

const replacement = '\n\n<!-- TMC_NO_MIDPAGE_APP_BANNER: mid-page app banner removed (footer version kept) -->\n\n';
text = text.slice(0, start) + replacement + text.slice(end);

if (wasCRLF) text = text.replace(/\n/g, '\r\n');

fs.writeFileSync(TARGET, text, 'utf8');
console.log(TARGET + ': mid-page app banner removed');
console.log('Backup saved in: ' + BACKUP_DIR + '/');
console.log('');
console.log('NEXT STEPS:');
console.log('  git add -A');
console.log('  git commit -m "Remove duplicate mid-page Get the TapMyCar App banner"');
console.log('  git push');
