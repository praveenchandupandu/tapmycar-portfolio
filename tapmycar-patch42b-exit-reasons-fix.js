/* ============================================================================
 * TapMyCar  Patch 42b  exit_reasons table fix
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch42b-exit-reasons-fix.js
 *
 * Fixes the bug in Patch 42 where exit reasons were written to the user row
 * and then immediately deleted by the cascade-delete. Two code edits:
 *
 *   1. api/delete-account.js
 *      Replaces the broken users.update() — which writes to a row that's
 *      about to be deleted — with an INSERT into the new exit_reasons table
 *      (anonymised: no user_id, no email). The marketing_suppression insert
 *      stays as-is; that was always correct.
 *
 *   2. api/get-retention-stats.js
 *      Reads exit_reasons from the new table instead of querying the
 *      (now-empty) users.exit_reason_* columns. The other two stats
 *      (opted-in users, lapsed emails) are unchanged.
 *
 * BEFORE running this code patch, run patch42b-migration.sql in Supabase.
 *
 * Note: this leaves Patch 41's three users.exit_reason_* columns and three
 * users.marketing_consent_* columns in place, unused. They're harmless;
 * a cleanup migration can drop them later.
 *
 * SAFE TO RE-RUN: each file is skipped if it already contains TMC_PATCH42B.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH42B';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch42b-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* ========================================================================
 * EDIT 1  api/delete-account.js  — write exit reason to exit_reasons table
 * ======================================================================*/

const DELETE_ACCOUNT = path.join('api', 'delete-account.js');

const DA_FIND = [
  "  /* TMC_PATCH42_EXITREASON: capture exit reason + marketing consent BEFORE",
  "     the cascade-delete runs. Failures here are non-fatal — we never want",
  "     a logging hiccup to block a user's right to delete their account. */",
  "  try {",
  "    const VALID = ['too_expensive','no_longer_need','not_as_expected','privacy_concerns','found_alternative','other'];",
  "    const code = VALID.indexOf(exit_reason_code) !== -1 ? exit_reason_code : null;",
  "    const text = typeof exit_reason_text === 'string' ? exit_reason_text.slice(0, 1000) : null;",
  "    const consent = marketing_consent === true;",
  "    /* email_opt_out is the canonical opt-out flag the broadcast system",
  "       reads. consent === true means we may email them; opt_out = false. */",
  "    await supabase.from('users').update({",
  "      exit_reason: text,",
  "      exit_reason_code: code,",
  "      exit_reason_at: new Date().toISOString(),",
  "      marketing_consent: consent,",
  "      marketing_consent_at: new Date().toISOString(),",
  "      marketing_consent_source: 'pre_delete_modal',",
  "      email_opt_out: !consent",
  "    }).eq('id', user_id);",
  "    /* If they did NOT opt in, add a suppression row keyed by email so a",
  "       re-registration with the same email stays suppressed forever. */",
  "    if (!consent && userEmail) {",
  "      await supabase.from('marketing_suppression').insert({",
  "        email: userEmail,",
  "        reason: 'account_deleted',",
  "        source: 'pre_delete_modal'",
  "      });",
  "    }",
  "  } catch (e) {",
  "    console.warn('TMC_PATCH42 exit-reason capture failed (non-fatal):', e && e.message);",
  "  }"
].join('\n');

const DA_REPLACE = [
  "  /* TMC_PATCH42B_EXITREASON: capture exit reason into the dedicated",
  "     exit_reasons table (anonymised — no user_id), which survives the",
  "     cascade-delete below. Patch 42 wrote to the user row which then got",
  "     deleted; this fix preserves the data for the Retention tab.",
  "     Failures here are non-fatal — never block a user's right to delete. */",
  "  try {",
  "    const VALID = ['too_expensive','no_longer_need','not_as_expected','privacy_concerns','found_alternative','other'];",
  "    const code = VALID.indexOf(exit_reason_code) !== -1 ? exit_reason_code : null;",
  "    const text = typeof exit_reason_text === 'string' ? exit_reason_text.slice(0, 1000) : null;",
  "    const consent = marketing_consent === true;",
  "    /* anonymous analytics row — no PII linking back to the deleted user */",
  "    if (code) {",
  "      const ageMs = user.created_at ? (Date.now() - new Date(user.created_at).getTime()) : null;",
  "      const ageDays = ageMs !== null ? Math.floor(ageMs / 86400000) : null;",
  "      await supabase.from('exit_reasons').insert({",
  "        reason_code:      code,",
  "        reason_text:      text,",
  "        plan_at_exit:     user.plan || null,",
  "        account_age_days: ageDays,",
  "        consent_given:    consent",
  "      });",
  "    }",
  "    /* If they did NOT opt in, add a suppression row keyed by email so a",
  "       re-registration with the same email stays suppressed forever. */",
  "    if (!consent && userEmail) {",
  "      await supabase.from('marketing_suppression').insert({",
  "        email: userEmail,",
  "        reason: 'account_deleted',",
  "        source: 'pre_delete_modal'",
  "      });",
  "    }",
  "  } catch (e) {",
  "    console.warn('TMC_PATCH42B exit-reason capture failed (non-fatal):', e && e.message);",
  "  }"
].join('\n');

/* ========================================================================
 * EDIT 2  api/get-retention-stats.js  — read from exit_reasons table
 * ======================================================================*/

const RETENTION = path.join('api', 'get-retention-stats.js');

const R_FIND = [
  "    /* Exit reasons in last 90 days, grouped client-side (Supabase JS",
  "       doesn't expose group-by; the volumes are small enough that fetching",
  "       the rows and counting in JS is fine). */",
  "    const { data: exits } = await supabase",
  "      .from('users')",
  "      .select('exit_reason_code')",
  "      .gte('exit_reason_at', ninetyDays)",
  "      .not('exit_reason_code', 'is', null);",
  "    const exit_reasons = {};",
  "    (exits || []).forEach(r => {",
  "      const k = r.exit_reason_code || 'unknown';",
  "      exit_reasons[k] = (exit_reasons[k] || 0) + 1;",
  "    });"
].join('\n');

const R_REPLACE = [
  "    /* TMC_PATCH42B: read from the dedicated exit_reasons table (which",
  "       survives user deletion), grouped client-side. Volumes are small;",
  "       fetching rows and counting in JS is fine. */",
  "    const { data: exits } = await supabase",
  "      .from('exit_reasons')",
  "      .select('reason_code')",
  "      .gte('created_at', ninetyDays);",
  "    const exit_reasons = {};",
  "    (exits || []).forEach(r => {",
  "      const k = r.reason_code || 'unknown';",
  "      exit_reasons[k] = (exit_reasons[k] || 0) + 1;",
  "    });"
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 42b  exit_reasons table fix');
log('Backup -> ' + BACKUP_DIR + '\n');

const FILES = [
  { path: DELETE_ACCOUNT, label: 'delete-account.js', find: DA_FIND, replace: DA_REPLACE },
  { path: RETENTION,      label: 'get-retention-stats.js', find: R_FIND, replace: R_REPLACE }
];

const planned = [];
let skipped = 0;

for (const F of FILES) {
  if (!fs.existsSync(F.path)) fail('expected file not found: ' + F.path);
  const original = fs.readFileSync(F.path, 'utf8');

  if (original.indexOf(MARKER) !== -1) {
    log(F.path + ': skip (already patched)');
    skipped++;
    continue;
  }

  const wasCRLF = original.indexOf('\r\n') !== -1;
  let updated = original.replace(/\r\n/g, '\n');

  const i = updated.indexOf(F.find);
  if (i === -1) fail('pattern NOT FOUND in ' + F.path + '  [' + F.label + ']. NOTHING was written.');
  if (updated.indexOf(F.find, i + 1) !== -1) fail('pattern NOT UNIQUE in ' + F.path);
  updated = updated.replace(F.find, function () { return F.replace; });

  if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
  planned.push({ file: F.path, original, updated });
  log(F.path + ': ready');
}

if (planned.length === 0) {
  log('\nAll files already patched. Nothing to do.\n');
  process.exit(0);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
for (const p of planned) {
  const dest = path.join(BACKUP_DIR, p.file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(p.file, dest);
  fs.writeFileSync(p.file, p.updated, 'utf8');
}

let checkFailed = null;
for (const p of planned) {
  try {
    execSync('node --check "' + p.file + '"', { stdio: 'pipe' });
  } catch (e) {
    checkFailed = { file: p.file, err: String(e.stderr || e.message) };
    break;
  }
}

if (checkFailed) {
  for (const p of planned) fs.writeFileSync(p.file, p.original, 'utf8');
  fail('node --check FAILED for ' + checkFailed.file
    + '  ALL files were restored to their original content.\n'
    + checkFailed.err);
}

log('   - syntax check: OK for all ' + planned.length + ' files\n');
log('Done. Files changed: ' + planned.length + (skipped ? ('  (' + skipped + ' skipped)') : '') + '\n');

log('IMPORTANT  run patch42b-migration.sql in Supabase FIRST if you have not.');
log('Then:');
log('  1. git add -A');
log('  2. git commit -m "Patch 42b: exit_reasons table (survives user deletion)"');
log('  3. git push   (wait ~60s for Vercel)');
log('  4. Test by deleting a test account through the modal, then refresh');
log('     the admin Retention tab. Exits captured (90d) should go up.\n');
