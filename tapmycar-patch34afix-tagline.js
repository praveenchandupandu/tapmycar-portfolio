// ============================================================================
// TapMyCar - Patch 34a-fix: Welcome page tagline correction
//
// Tiny one-line fix to Patch 34a. The redesigned welcome page used the
// tagline "Privacy-first vehicle contact" (I made that up). The correct
// canonical tagline used everywhere else (dashboard.html, etag.html, brand
// block in contact.html line 615) is:
//   "Privacy for you. Safety for your car."
//
// Properties: idempotent.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch34afix-${ts}`);

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
function safeReplace(content, oldStr, newStr) {
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldStr)) return content.replace(oldStr, () => newStr);
  if (content.includes(oldCRLF)) {
    const newCRLF = newStr.replace(/\n/g, '\r\n');
    return content.replace(oldCRLF, () => newCRLF);
  }
  return null;
}

log('');
log('TapMyCar Patch 34a-fix \u2014 welcome tagline correction');
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH34AFIX_TAGLINE';

const file = path.join(PUBLIC, 'contact.html');
const content = readFile(file);

if (content.includes(MARKER)) {
  skip('contact.html (already patched)');
  process.exit(0);
}

backup(file);

const oldLine = `<div style="font-size:20px;font-weight:800;color:#111;margin-bottom:6px">Privacy-first vehicle contact</div>
      <div style="font-size:13px;color:#6B7280;line-height:1.55;max-width:320px;margin:0 auto">Activate your tag so strangers can reach you privately \u2014 without ever seeing your real number.</div>`;

const newLine = `<!-- ${MARKER} -->
      <div style="font-size:20px;font-weight:800;color:#111;margin-bottom:6px">Privacy for you. Safety for your car.</div>
      <div style="font-size:13px;color:#6B7280;line-height:1.55;max-width:320px;margin:0 auto">Activate your tag so strangers can reach you privately \u2014 without ever seeing your real number.</div>`;

const r = safeReplace(content, oldLine, newLine);
if (!r) errExit('contact.html: tagline anchor not found');

writeFile(file, r);
ok('Tagline updated to "Privacy for you. Safety for your car."');

log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 34a-fix: welcome tagline correction"');
log('  git push');
