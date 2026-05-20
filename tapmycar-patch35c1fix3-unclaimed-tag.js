// ============================================================================
// TapMyCar - Patch 35c-1-fix-3: Populate window._tag for unclaimed tags
//
// Root cause of "gift Step 4 still shows the paid eTag screen":
//
// In contact.html, loadTag() only sets window._tag in the status==='active'
// branch (line ~816). The status==='unclaimed' branch (line ~813) shows the
// activation flow but NEVER sets window._tag.
//
// Every gift-detection check added by Patches 35c-1-fix and 35c-1-fix-2
// reads window._tag.is_gift. For an unclaimed gift tag window._tag is
// undefined, so:
//   - startActivation() does not route into the no-payment flow
//   - the pay-button hook does not skip payment
//   - the Step 4 gift renderer never fires
// ...and the user sees the normal paid eTag Step 4.
//
// Fix: in the unclaimed branch of loadTag(), also set window._tag = tag.
// This single line makes all the previously-deployed gift logic work,
// because they were all correct - they just had no tag object to read.
//
// One file: public/contact.html. Idempotent, safeReplace, backup, verify.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35c1fix3-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p + '  (run this from inside your tapmycar project folder)');
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
log('TapMyCar Patch 35c-1-fix-3 \u2014 populate window._tag for unclaimed tags');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35C1FIX3_UNCLAIMED_TAG';

const file = path.join(PUBLIC, 'contact.html');
const content = readFile(file);

if (content.includes(MARKER)) {
  skip('contact.html (already patched)');
  process.exit(0);
}
backup(file);

/* The unclaimed branch. Match the exact line and add window._tag = tag. */
const oldLine = `    else if(tag.status==='unclaimed'){document.getElementById('unclaimed-token').textContent=tag.token;showState('unclaimed');}`;

const newLine = `    else if(tag.status==='unclaimed'){/*${MARKER}: set window._tag so gift detection works*/window._tag=tag;window._tagId=tag.id||'';document.getElementById('unclaimed-token').textContent=tag.token;showState('unclaimed');}`;

const r = safeReplace(content, oldLine, newLine);
if (!r) errExit('contact.html: unclaimed branch anchor not found');

writeFile(file, r);

const verify = readFile(file);
if (!verify.includes(MARKER)) errExit('marker missing after write');
if (!verify.includes('window._tag=tag;window._tagId')) errExit('window._tag assignment not found after write');
ok('loadTag unclaimed branch now sets window._tag (gift detection enabled)');

log('');
log('==============================================================');
log('Patch 35c-1-fix-3 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('This is the missing piece. Patches 35c-1-fix and 35c-1-fix-2 were');
log('correct but had no tag object to read on unclaimed tags. Now they do.');
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35c-1-fix-3: set window._tag for unclaimed tags"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('Test (new user, gift tag, tap path):');
log('  1. HARD REFRESH first \u2014 force-close the browser or use a fresh');
log('     incognito tab. The old contact.html is cached.');
log('  2. Tap a gift sticker (or open /tag/TMC-XXXXXX) as a new user.');
log('  3. Activate The Tag -> Step 1 (phone field has US +1 dropdown) ->');
log('     vehicle -> phone verify -> Step 4.');
log('  4. Step 4 should now show "Your gift" / "<Plan> - N-month trial');
log('     FREE", NO $1.00, NO auto-upgrade box, button "Claim my free tag".');
log('');
log('If Step 4 STILL shows the paid screen after a hard refresh, open the');
log('browser console on that page and run:  console.log(window._tag)');
log('and tell me what it prints.');
log('==============================================================');
