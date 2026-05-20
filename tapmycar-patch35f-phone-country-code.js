// ============================================================================
// TapMyCar - Patch 35f: Country-code dropdown on the registration phone field
//
// The Step 1 "Phone number" field on contact.html is a plain text input
// (placeholder "+1 (203) 555-0100"). The newer register.html / settings.html
// pages use a "US +1" country-code <select> next to the number input.
//
// This patch brings contact.html's Step 1 phone field in line:
//   - adds the same country-code <select> (id: s1-country-code) with the
//     same country list register.html uses
//   - the number input keeps id s1-phone, placeholder becomes "(203) 555-0100"
//   - the value read in collectStep1 / goToStep2 now combines them:
//       countryCode + digitsOnly(phone)
//     exactly like register.html does
//
// One file: public/contact.html. Idempotent, safeReplace, backup, verify.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35f-${ts}`);

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
log('TapMyCar Patch 35f \u2014 country-code dropdown on registration phone field');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35F_PHONE_COUNTRY_CODE';

const file = path.join(PUBLIC, 'contact.html');
const content = readFile(file);

if (content.includes(MARKER)) {
  skip('contact.html (already patched)');
  process.exit(0);
}
backup(file);

let updated = content;

// =============================================================================
// 1. Replace the plain phone field with country-code select + input
// =============================================================================

const oldField = `    <div class="field"><label>Phone number <span style="color:#DC2626">*</span></label><input type="tel" id="s1-phone" placeholder="+1 (203) 555-0100" autocomplete="tel"><div class="hint">For masked call forwarding only  never shared</div></div>`;

const newField = `    <!-- ${MARKER}: country-code dropdown + number input -->
    <div class="field"><label>Phone number <span style="color:#DC2626">*</span></label>
      <div style="display:flex;gap:8px;align-items:stretch">
        <select id="s1-country-code" style="height:46px;border:1.5px solid #E5E7EB;border-radius:11px;padding:0 10px;font-size:14px;font-family:'Inter',sans-serif;background:#F9FAFB;outline:none;color:#111;min-width:90px">
          <option value="+1">US +1</option>
          <option value="+44">UK +44</option>
          <option value="+91">IN +91</option>
          <option value="+61">AU +61</option>
          <option value="+1-CA">CA +1</option>
          <option value="+49">DE +49</option>
          <option value="+33">FR +33</option>
          <option value="+39">IT +39</option>
          <option value="+34">ES +34</option>
          <option value="+55">BR +55</option>
          <option value="+52">MX +52</option>
          <option value="+971">AE +971</option>
          <option value="+65">SG +65</option>
          <option value="+81">JP +81</option>
          <option value="+82">KR +82</option>
          <option value="+86">CN +86</option>
        </select>
        <input type="tel" id="s1-phone" placeholder="(203) 555-0100" autocomplete="tel" style="flex:1">
      </div>
      <div class="hint">For masked call forwarding only  never shared</div>
    </div>`;

let r = safeReplace(updated, oldField, newField);
if (!r) errExit('contact.html: s1-phone field anchor not found');
updated = r;
ok('Phone field replaced with country-code dropdown + input');

// =============================================================================
// 2. Update the phone read so it combines country code + digits
// =============================================================================

const oldRead = `  const phone=document.getElementById('s1-phone').value.trim();`;

const newRead = `  /* ${MARKER}: combine country code + digits-only number, like register.html */
  const _ccEl=document.getElementById('s1-country-code');
  const _cc=(_ccEl?_ccEl.value:'+1').replace('-CA','');
  const _phoneDigits=document.getElementById('s1-phone').value.trim().replace(/[^0-9]/g,'');
  const phone=_phoneDigits?(_cc+_phoneDigits):'';`;

r = safeReplace(updated, oldRead, newRead);
if (!r) errExit('contact.html: s1-phone read anchor not found');
updated = r;
ok('Phone read now combines country code + number');

writeFile(file, updated);

const verify = readFile(file);
const markerCount = (verify.match(/TMC_PATCH35F_PHONE_COUNTRY_CODE/g) || []).length;
if (markerCount < 2) errExit('marker count too low (' + markerCount + ')');
if (!verify.includes('s1-country-code')) errExit('country-code select missing after write');
ok('contact.html written and verified (' + markerCount + ' markers)');

log('');
log('==============================================================');
log('Patch 35f complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35f: country-code dropdown on registration phone field"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('Test:');
log('  1. Open a tag activation as a new user (e.g. /tag/TMC-XXXXXX).');
log('  2. On Step 1 the Phone number field now has a "US +1" dropdown');
log('     to the left of the number input, matching the register page.');
log('  3. Enter a number, continue. The phone is saved as country code +');
log('     digits (e.g. +12034357383) exactly as before.');
log('==============================================================');
