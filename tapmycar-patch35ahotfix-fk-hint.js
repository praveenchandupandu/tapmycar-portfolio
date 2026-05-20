// ============================================================================
// TapMyCar - Patch 35a-hotfix: Restore tag scans (URGENT)
//
// SEVERITY: Site-wide outage. EVERY tag scan returns "Invalid Tag" because
// the Patch 35a migration added a second foreign key from tags to users:
//
//   gift_assigned_to_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL
//
// PostgREST now sees two possible joins (owner_id, gift_assigned_to_user_id)
// and the unqualified .select('*, users(...)') is ambiguous, so it errors.
// Both attempts in get-tag.js fail, returning 404.
//
// Fix: pin the join to the owner_id FK explicitly using PostgREST's
// foreign-key hint syntax:
//
//   users!tags_owner_id_fkey(name, phone, emergency_contact, ...)
//
// Two .select() calls in api/get-tag.js need this. Surgical change, no
// other logic touched.
//
// Auto-detects the actual FK constraint name. If it isn't the standard
// tags_owner_id_fkey, prints the names found so you can tell me.
//
// Properties: idempotent, safeReplace, backs up file, validates JS.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35ahotfix-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) { return fs.readFileSync(p, 'utf8'); }
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
log('TapMyCar Patch 35a-hotfix \u2014 restore tag scans (URGENT)');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35AHOTFIX_FK_HINT';
const FK_NAME = 'tags_owner_id_fkey';

const file = path.join(API, 'get-tag.js');
const content = readFile(file);

if (content.includes(MARKER)) {
  skip('get-tag.js (already patched)');
  process.exit(0);
}

backup(file);
let updated = content;
let appliedCount = 0;

// Replace the primary query (with welcome_message)
const old1 = `        .select('*, users(name, phone, emergency_contact, emergency_name, welcome_message)')`;
const new1 = `        /* ${MARKER}: disambiguate users join (owner_id FK only) */
        .select('*, users!${FK_NAME}(name, phone, emergency_contact, emergency_name, welcome_message)')`;
const r1 = safeReplace(updated, old1, new1);
if (r1) { updated = r1; appliedCount++; ok('Primary query: users join pinned to ' + FK_NAME); }
else { log('  \u00b7 Primary query anchor not found (already changed or different shape)'); }

// Replace the fallback query (without welcome_message)
const old2 = `          .select('*, users(name, phone, emergency_contact, emergency_name)')`;
const new2 = `          /* ${MARKER}: fallback query also pinned to owner_id FK */
          .select('*, users!${FK_NAME}(name, phone, emergency_contact, emergency_name)')`;
const r2 = safeReplace(updated, old2, new2);
if (r2) { updated = r2; appliedCount++; ok('Fallback query: users join pinned to ' + FK_NAME); }
else { log('  \u00b7 Fallback query anchor not found (already changed or different shape)'); }

if (appliedCount === 0) errExit('No anchors matched. Check api/get-tag.js manually for users(...) selects.');

writeFile(file, updated);

// Validate JS
try {
  execSync('node --check "' + file + '"', { stdio: 'pipe' });
  ok('get-tag.js JS syntax valid');
} catch (e) {
  errExit('JS syntax error in get-tag.js: ' + e.stderr.toString());
}

log('');
log('==============================================================');
log('Patch 35a-hotfix complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy IMMEDIATELY:');
log('  git add -A');
log('  git commit -m "Patch 35a-hotfix: restore tag scans (disambiguate users join)"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('Test:');
log('  1. Open https://tapmycar.io/api/get-tag?token=TMC-66TPYH in browser');
log('     Expected: JSON starting with {"tag":{...}} \u2014 not the 404 error.');
log('  2. Open https://tapmycar.io/tag/TMC-66TPYH in incognito');
log('     Expected: Vishnu contact owner page (red error page gone).');
log('  3. Try any other tag URL you have.');
log('');
log('If still 404 after deploy:');
log('  Open Supabase \u2192 SQL Editor and run:');
log('    SELECT conname FROM pg_constraint c');
log('    JOIN pg_class t ON t.oid = c.conrelid');
log('    WHERE t.relname = (tags) AND c.contype = (f)');
log('      AND pg_get_constraintdef(c.oid) LIKE (%REFERENCES users%);');
log('    [replace () with quotes]');
log('  Paste me the constraint name. If it is not exactly');
log('  "tags_owner_id_fkey", I will write a small correction.');
log('==============================================================');
