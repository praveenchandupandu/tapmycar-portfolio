// ============================================================================
// TapMyCar - Patch 35d-renew-fix-2: Allow 'renew' past the flow whitelist
//
// Bug: create-checkout.js has a whitelist guard:
//
//     if (flow !== 'activate' && flow !== 'direct') {
//       return res.status(400).json({ error: `Invalid flow '${flow}'` });
//     }
//
// This runs BEFORE the flow branches. Patch 35d-renew added the 'renew'
// flow block lower down (line ~171), but the guard rejects 'renew' before
// execution ever reaches it -> the live site returns
//   400  {"error":"Invalid flow 'renew'"}
//
// Fix: add 'renew' to the whitelist guard so the request reaches the
// renew block. One-line change in api/create-checkout.js.
//
// Idempotent, safeReplace, backup, JS validation.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35drenewfix2-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p + '  (run from inside the tapmycar project folder)');
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
log('TapMyCar Patch 35d-renew-fix-2 \u2014 allow renew past the flow whitelist');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35DRENEWFIX2_WHITELIST';

const file = path.join(API, 'create-checkout.js');
const content = readFile(file);

if (content.includes(MARKER)) {
  skip('create-checkout.js (already patched)');
  process.exit(0);
}
backup(file);

const oldGuard = `  if (flow !== 'activate' && flow !== 'direct') {
    return res.status(400).json({ error: \`Invalid flow '\${flow}'\` });
  }`;

const newGuard = `  /* ${MARKER}: allow the renew flow past the whitelist guard */
  if (flow !== 'activate' && flow !== 'direct' && flow !== 'renew') {
    return res.status(400).json({ error: \`Invalid flow '\${flow}'\` });
  }`;

const r = safeReplace(content, oldGuard, newGuard);
if (!r) errExit('create-checkout.js: flow whitelist guard anchor not found');

writeFile(file, r);

try {
  execSync('node --check "' + file + '"', { stdio: 'pipe' });
} catch (e) {
  errExit('create-checkout.js JS error: ' + e.stderr.toString());
}

const verify = readFile(file);
if (!verify.includes(MARKER)) errExit('marker missing after write');
if (!verify.includes("flow !== 'renew'")) errExit('renew not added to whitelist');
ok('create-checkout.js: renew flow allowed past the whitelist guard');

log('');
log('==============================================================');
log('Patch 35d-renew-fix-2 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35d-renew-fix-2: allow renew past flow whitelist"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('Test:');
log('  1. Fresh incognito -> dashboard -> sign in as the gift test user.');
log('  2. Click "Subscribe now".');
log('  3. No more "Invalid flow renew" alert. Stripe Checkout should open.');
log('  4. Confirm it shows ONLY the annual price (no sticker fee, no');
log('     shipping address form).');
log('==============================================================');
