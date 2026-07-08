const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const FILE = path.join('api', 'verify-otp.js');
const FROM = "      if (String(email).trim().toLowerCase() === _TMC_REVIEW_EMAIL &&";
const TO   = "      if (process.env.REVIEW_BYPASS === 'on' &&\n          String(email).trim().toLowerCase() === _TMC_REVIEW_EMAIL &&";
const DONE = "process.env.REVIEW_BYPASS === 'on'";
if (!fs.existsSync(FILE)) { console.log('ABORT - ' + FILE + ' not found.'); process.exit(1); }
const original = fs.readFileSync(FILE, 'latin1');
if (original.indexOf('TMC_PATCH_REVIEW_LOGIN') === -1) { console.log('ABORT - patch-12 block not found. Is patch 12 pushed?'); process.exit(1); }
if (original.indexOf(DONE) !== -1) { console.log('Already gated by REVIEW_BYPASS (skip).'); process.exit(0); }
const idx = original.indexOf(FROM), last = original.lastIndexOf(FROM);
if (idx === -1) { console.log('ABORT - guard line not found. No change.'); process.exit(1); }
if (idx !== last) { console.log('ABORT - guard line found more than once. No change.'); process.exit(1); }
const b = FILE + '.bak-envgate';
fs.copyFileSync(FILE, b);
try {
  const updated = original.replace(FROM, TO);
  if (updated.indexOf(DONE) === -1) throw new Error('post-edit marker missing');
  fs.writeFileSync(FILE, Buffer.from(updated, 'latin1'));
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
  console.log('OK - reviewer bypass now gated by REVIEW_BYPASS. Backup: ' + b);
} catch (e) { fs.copyFileSync(b, FILE); console.log('FAILED -> restored. ' + (e.message||e)); process.exit(1); }
