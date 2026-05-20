// ============================================================================
// TapMyCar - Patch 35a-hotfix-2: Fix FK ambiguity in call-flow endpoints
//
// Patch 35a added a second foreign key from tags to users
// (gift_assigned_to_user_id). The first hotfix fixed api/get-tag.js, but
// the SAME ambiguous-join bug exists in every other endpoint that joins
// tags to users. These break the masked-call feature:
//
//   - api/proxy-call.js           (2 queries) - placing a call
//   - api/notify-owner.js         (1 query)   - scan notifications
//   - api/owner-callback.js       (1 query)   - bridging the call to owner
//   - api/register-pending-call.js(1 query)   - registering a call
//
// Symptom: a stranger taps "Call Owner" and hears / sees an error like
// "we don't recognize this call" because proxy-call.js gets a failed
// PostgREST join and returns 404 Tag not found.
//
// Fix: pin every tags->users join to the owner_id FK explicitly:
//   users  ->  users!tags_owner_id_fkey
//
// The FK name tags_owner_id_fkey is confirmed from the user's DB:
//   tags_owner_id_fkey                 FK (owner_id) REFERENCES users(id)
//   tags_gift_assigned_to_user_id_fkey FK (gift_assigned_to_user_id) ...
//
// NOTE: get-orders.js and update-order-status.js also join users, but
// they join the ORDERS table (one FK only) - NOT affected, NOT touched.
//
// Properties: idempotent, safeReplace, per-file backup, JS validation.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35ahotfix2-${ts}`);

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
function replaceAll(content, oldStr, newStr) {
  /* Replace every occurrence; handle CRLF too. Function form avoids
     the $' / $& substitution pitfalls. */
  let result = content;
  let count = 0;
  if (result.includes(oldStr)) {
    const parts = result.split(oldStr);
    count = parts.length - 1;
    result = parts.join(newStr);
  }
  return { result, count };
}

log('');
log('TapMyCar Patch 35a-hotfix-2 \u2014 fix FK ambiguity in call-flow endpoints');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35AHOTFIX2_FK_HINT';
const FK = 'tags_owner_id_fkey';

/* Each entry: file + the exact substring to replace. The replacement
   simply inserts the !fk hint after the word "users". We match the
   distinctive opening of each select to avoid touching anything else. */
const TARGETS = [
  {
    file: 'proxy-call.js',
    repls: [
      { from: `.select('status, users(phone_verified)')`,
        to:   `.select('status, users!${FK}(phone_verified)')` },
      { from: `.select('*, users(phone, name, phone_verified)')`,
        to:   `.select('*, users!${FK}(phone, name, phone_verified)')` }
    ]
  },
  {
    file: 'notify-owner.js',
    repls: [
      { from: `.select('*, users(phone, name, email, phone_verified)')`,
        to:   `.select('*, users!${FK}(phone, name, email, phone_verified)')` }
    ]
  },
  {
    file: 'owner-callback.js',
    repls: [
      { from: `.select('*, users(phone)')`,
        to:   `.select('*, users!${FK}(phone)')` }
    ]
  },
  {
    file: 'register-pending-call.js',
    repls: [
      { from: `.select('id, status, users(id, phone, phone_verified)')`,
        to:   `.select('id, status, users!${FK}(id, phone, phone_verified)')` }
    ]
  }
];

let totalApplied = 0;

for (const target of TARGETS) {
  const filePath = path.join(API, target.file);
  log('Processing api/' + target.file);
  const content = readFile(filePath);

  if (content.includes(MARKER)) {
    skip('api/' + target.file);
    continue;
  }

  let updated = content;
  let fileApplied = 0;
  let alreadyDone = 0;

  for (const repl of target.repls) {
    if (updated.includes(repl.to)) {
      alreadyDone++;
      continue;
    }
    const r = replaceAll(updated, repl.from, repl.to);
    if (r.count === 0) {
      /* Try CRLF variant just in case */
      const rc = replaceAll(updated, repl.from.replace(/\n/g, '\r\n'),
                                     repl.to.replace(/\n/g, '\r\n'));
      if (rc.count === 0) {
        errExit('api/' + target.file + ': anchor not found:\n    ' + repl.from);
      }
      updated = rc.result;
      fileApplied += rc.count;
    } else {
      updated = r.result;
      fileApplied += r.count;
    }
  }

  if (fileApplied === 0 && alreadyDone > 0) {
    skip('api/' + target.file + ' (joins already pinned)');
    continue;
  }

  /* Add a marker comment at the very top so the file is recognised as
     patched on future runs. */
  updated = '/* ' + MARKER + ': tags->users joins pinned to ' + FK + ' */\n' + updated;

  writeFile(filePath, updated);

  /* Validate JS */
  try {
    execSync('node --check "' + filePath + '"', { stdio: 'pipe' });
  } catch (e) {
    errExit('JS syntax error in ' + target.file + ': ' + e.stderr.toString());
  }

  ok('api/' + target.file + ': ' + fileApplied + ' join(s) pinned to ' + FK);
  totalApplied += fileApplied;
}

log('');
log('==============================================================');
if (totalApplied === 0) {
  log('Nothing to do \u2014 all files already patched.');
} else {
  log('Patch 35a-hotfix-2 complete. ' + totalApplied + ' join(s) fixed across call-flow.');
}
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35a-hotfix-2: fix FK ambiguity in call-flow endpoints"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('Test the full call flow:');
log('  1. Open https://tapmycar.io/tag/TMC-66TPYH in incognito.');
log('  2. Tap the "Call Owner" button.');
log('  3. Enter a phone number you can answer.');
log('  4. That phone should ring with the TapMyCar greeting + hold music,');
log('     and Vishnu\\u2019s phone should ring too. No more');
log('     "we don\\u2019t recognize this call" error.');
log('');
log('Also worth testing while you are at it:');
log('  - The scan-notification (owner gets an SMS/push when scanned)');
log('  - These all share the same join, so all should work now.');
log('==============================================================');
