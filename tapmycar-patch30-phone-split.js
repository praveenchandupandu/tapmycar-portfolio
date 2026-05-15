// ============================================================================
// TapMyCar - Patch 30: Settings — split stored phone back into
//                       country-code dropdown + local number on Edit Profile.
//
// Bug: stored phone is in E.164 format (e.g. "+12035071533" for a US number,
// "+919876543210" for India). When the Edit Profile modal opens, the code did:
//   document.getElementById('edit-phone').value = userData.phone || '';
// which dumped the entire string including the "+1" prefix into the local-
// number input. Visually: "US +1" dropdown is still selected AND the input
// shows "+12035071533" — country code duplicated.
//
// Fix: small helper splitPhone(stored) returns { cc, local } by matching
// the stored string's prefix against the dropdown's option values
// (LONGEST-MATCH-WINS so "+1" doesn't accidentally match a "+44" user).
// On open, set dropdown.value = cc and input.value = local.
//
// Save path was already correct (concatenates dropdown.value + digits) so
// no change needed there.
//
// Properties: idempotent, validates JS.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch30-${ts}`);

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
function tryReplace(content, oldStr, newStr) {
  if (content.includes(oldStr)) return content.replace(oldStr, newStr);
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF)) return content.replace(oldCRLF, newStr.replace(/\n/g, '\r\n'));
  return null;
}

log('');
log('TapMyCar Patch 30 \u2014 split stored E.164 phone on Edit Profile open');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH30_PHONE_SPLIT';

{
  const file = path.join(PUBLIC, 'settings.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('settings.html (already patched)');
  } else {
    backup(file);

    // Anchor on the entire openEditProfile function body. Replace the
    // line that dumps the full phone into edit-phone with a split helper.
    const anchor = `function openEditProfile() {
  if (userData) {
    document.getElementById('edit-name').value = userData.name || '';
    document.getElementById('edit-phone').value = userData.phone || '';
    document.getElementById('edit-email').value = userData.email || '';
    document.getElementById('edit-emergency-name').value = userData.emergency_name || '';
    document.getElementById('edit-emergency-phone').value = userData.emergency_contact || '';
    document.getElementById('edit-welcome-message').value = userData.welcome_message || '';
  }
  document.getElementById('edit-overlay').classList.add('show');
}`;

    const replacement = `/* ${MARKER}: split stored E.164 phone into country-code + local number */
function _p30SplitPhone(stored) {
  var s = (stored == null ? '' : String(stored)).trim();
  if (!s) return { cc: '+1', local: '' };
  /* Build a list of dropdown option values, sorted by length (descending)
     so longer prefixes match first ("+971" before "+9", "+44" before "+1"). */
  var sel = document.getElementById('edit-country-code');
  var values = [];
  if (sel && sel.options) {
    for (var i = 0; i < sel.options.length; i++) {
      var v = sel.options[i].value;
      if (v) values.push(v);
    }
  }
  values.sort(function(a, b) {
    /* Compare by the "+digits" part length, ignoring suffixes like "-CA" */
    var na = a.replace(/-.*$/, '').length;
    var nb = b.replace(/-.*$/, '').length;
    return nb - na;
  });
  for (var j = 0; j < values.length; j++) {
    var cc = values[j].replace(/-.*$/, ''); /* "+1-CA" -> "+1" for matching */
    if (s.indexOf(cc) === 0) {
      return { cc: values[j], local: s.slice(cc.length) };
    }
  }
  /* Stored doesn't start with any known cc -> treat as local-only US number. */
  if (s.charAt(0) === '+') {
    /* Has a + but unknown country. Keep as local for display. */
    return { cc: '+1', local: s };
  }
  return { cc: '+1', local: s };
}

function openEditProfile() {
  if (userData) {
    document.getElementById('edit-name').value = userData.name || '';
    /* ${MARKER}: split phone into dropdown + input */
    var _p30 = _p30SplitPhone(userData.phone);
    var _ccSel = document.getElementById('edit-country-code');
    if (_ccSel) {
      /* Try exact match first; if a country-specific variant like "+1-CA"
         exists in stored data, prefer it. Otherwise fall back to plain cc. */
      var found = false;
      for (var i = 0; i < _ccSel.options.length; i++) {
        if (_ccSel.options[i].value === _p30.cc) { _ccSel.value = _p30.cc; found = true; break; }
      }
      if (!found) _ccSel.value = '+1';
    }
    document.getElementById('edit-phone').value = _p30.local;
    document.getElementById('edit-email').value = userData.email || '';
    document.getElementById('edit-emergency-name').value = userData.emergency_name || '';
    document.getElementById('edit-emergency-phone').value = userData.emergency_contact || '';
    document.getElementById('edit-welcome-message').value = userData.welcome_message || '';
  }
  document.getElementById('edit-overlay').classList.add('show');
}`;

    let r = tryReplace(content, anchor, replacement);
    if (!r) errExit('settings.html: openEditProfile anchor not found');

    writeFile(file, r);
    ok('settings.html: phone split helper added + openEditProfile updated');
  }
}

log('');
log('==============================================================');
log('Patch 30 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 30: split stored phone into country code + local on edit"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('Test after deploy:');
log('  1. Sign in as Chandu (or any user with a saved phone).');
log('  2. Open Settings > Edit profile.');
log('  3. Phone number area should now show TWO fields correctly:');
log('     [US +1] [2035071533]');
log('     NOT:');
log('     [US +1] [+12035071533]');
log('  4. Save changes \u2014 phone should remain valid E.164 in DB.');
log('  5. Reopen Edit profile \u2014 should still display correctly split.');
log('==============================================================');
