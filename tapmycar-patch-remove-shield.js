/* ============================================================================
 * TapMyCar  Patch  Remove 3D shield from harassment section on landing.html
 *
 * Strips the entire <div class="lo-shield-wrap"> block (3D shield + rotating
 * rings + glow halo) from the "What if someone abuses the system?" section.
 * Pillar cards below stay intact. The shield CSS rules stay in the <style>
 * block but are now dead code (harmless, ~600 bytes); leave them for now in
 * case the shield needs to come back.
 *
 * Idempotent: skips if TMC_NO_SHIELD marker already present.
 *
 * Run from project root:  node tapmycar-patch-remove-shield.js
 * Safe to re-run.
 * ==========================================================================*/
'use strict';
const fs   = require('fs');
const path = require('path');

const STAMP      = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-remove-shield-' + STAMP;
const TARGET     = path.join('public', 'landing.html');

if (!fs.existsSync(TARGET)) { console.error(TARGET + ' not found.'); process.exit(1); }
let text = fs.readFileSync(TARGET, 'utf8');

if (text.indexOf('TMC_NO_SHIELD') !== -1) {
  console.log(TARGET + ': skip (shield already removed)');
  process.exit(0);
}

// Backup
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(path.join(BACKUP_DIR, 'public'), { recursive: true });
fs.copyFileSync(TARGET, path.join(BACKUP_DIR, TARGET));

// Normalize line endings for processing
const wasCRLF = text.indexOf('\r\n') !== -1;
text = text.replace(/\r\n/g, '\n');

// Remove the entire <div class="lo-shield-wrap"> ... </div> block
// (it ends right before the <div class="lo-pillars">)
const shieldRe = /\s*<div class="lo-shield-wrap">[\s\S]*?<\/div>\s*<\/div>(?=\s*<div class="lo-pillars">)/;
const m = shieldRe.exec(text);
if (!m) {
  console.error('shield-wrap block not found  no changes made');
  process.exit(1);
}
text = text.slice(0, m.index) + '\n  <!-- TMC_NO_SHIELD -->\n  ' + text.slice(m.index + m[0].length);

// Restore CRLF
if (wasCRLF) text = text.replace(/\n/g, '\r\n');

fs.writeFileSync(TARGET, text, 'utf8');
console.log(TARGET + ': 3D shield removed from harassment section');
console.log('Backup saved in: ' + BACKUP_DIR + '/');
console.log('');
console.log('NEXT STEPS:');
console.log('  git add -A');
console.log('  git commit -m "Remove 3D shield from harassment section"');
console.log('  git push');
