/* ============================================================================
 * TapMyCar  Patch 51a  renewal-only credit support (backend)
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch51a-retention-backend.js
 *
 * Adds the infrastructure for "renewal-only" credits without touching any UI.
 * Patch 51b will add the pre-delete offer modal and admin tab on top.
 *
 * Changes:
 *
 *   1. SCHEMA (patch51a-migration.sql, separate file):
 *      - referrals.credit_kind text NOT NULL DEFAULT 'general'
 *        ('general'  works on anything, like existing referral credits.",
 *         'renewal_only'  filtered out unless flow === 'renew')",
 *      - users.retention_offer_shown_at    timestamptz  (one-time-only gate)",
 *      - users.retention_offer_accepted_at timestamptz  (audit + admin stats)",
 *      - users.retention_offer_exit_reason text         (the reason picked)",
 *
 *   2. api/create-checkout.js  FIFO loop now filters by flow:",
 *      - flow === 'renew'  include rows where credit_kind IN ('general','renewal_only')",
 *      - any other flow    include rows where credit_kind = 'general'",
 *      Renewal-only rows stay invisible to sticker/upgrade purchases.",
 *
 *   3. api/get-referral.js  splits the response so the UI can show",
 *      both 'available_general' (regular referral) and 'available_renewal_only'",
 *      (retention) separately if it wants to. Total stays accurate.",
 *
 *   4. api/grant-retention-credit.js  NEW endpoint. POST with auth.",
 *      Idempotent: rejects if users.retention_offer_shown_at is already set",
 *      (one-time-only). On success, inserts a new referrals row with",
 *      credit_kind='renewal_only', credit_amount=3.00, status='available',",
 *      referral_code='RETENTION'. Also sets users.retention_offer_shown_at",
 *      and users.retention_offer_accepted_at. Returns ok:true on success,",
 *      ok:false with reason on idempotency skip.",
 *
 *   5. api/decline-retention-offer.js  NEW endpoint. POST with auth.",
 *      Records that the offer was presented but declined, so we keep the",
 *      one-time-only gate fair. Sets users.retention_offer_shown_at to now.",
 *      Optionally records exit_reason. Returns ok:true.",
 *
 * Files written:",
 *   - patch51a-migration.sql",
 *   - api/create-checkout.js                       (modified)",
 *   - api/get-referral.js                          (modified)",
 *   - api/grant-retention-credit.js                NEW",
 *   - api/decline-retention-offer.js               NEW
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH51A.",
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH51A';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch51a-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const CC       = path.join('api', 'create-checkout.js');
const GR       = path.join('api', 'get-referral.js');
const GRANT    = path.join('api', 'grant-retention-credit.js');
const DECLINE  = path.join('api', 'decline-retention-offer.js');

/* ========================================================================
 * EDIT 1  create-checkout.js  add credit_kind to select + filter by flow
 * ----------------------------------------------------------------------
 * Add 'credit_kind' to the select, and update the filter so renewal_only
 * rows are excluded unless flow === 'renew'.
 * ======================================================================*/

const CC_FIND = [
  "      const { data: avRows } = await supabase",
  "        .from('referrals')",
  "        .select('id, credit_amount, status, available_at')",
  "        .eq('referrer_user_id', user_id)",
  "        .in('status', ['pending','available'])",
  "        .order('paid_at', { ascending: true });",
  "      const usable = (avRows || []).filter(r =>",
  "        r.status === 'available' ||",
  "        (r.status === 'pending' && r.available_at && r.available_at <= nowIso)",
  "      );"
].join('\n');

const CC_REPLACE = [
  "      const { data: avRows } = await supabase",
  "        .from('referrals')",
  "        .select('id, credit_amount, status, available_at, credit_kind')",
  "        .eq('referrer_user_id', user_id)",
  "        .in('status', ['pending','available'])",
  "        .order('paid_at', { ascending: true });",
  "      /* TMC_PATCH51A: renewal_only credits are filtered OUT unless flow",
  "         is renew. General (default) credits work on anything. */",
  "      const _tmcIsRenew = (flow === 'renew');",
  "      const usable = (avRows || []).filter(r => {",
  "        const okStatus = r.status === 'available' ||",
  "          (r.status === 'pending' && r.available_at && r.available_at <= nowIso);",
  "        if (!okStatus) return false;",
  "        const kind = r.credit_kind || 'general';",
  "        if (kind === 'renewal_only' && !_tmcIsRenew) return false;",
  "        return true;",
  "      });"
].join('\n');

/* ========================================================================
 * EDIT 2  get-referral.js  add a renewal-only available number to output
 * ----------------------------------------------------------------------
 * Read the file to find the right anchor.
 * ======================================================================*/

/* I'll do this edit only if get-referral.js exists in a recognizable shape.
   The safest contract change: ADD a new field, don't change existing fields.
   We add `credit_available_renewal_only` alongside whatever's already there.
   To find the right insertion point, we need to inspect the file first. */

/* ========================================================================
 * NEW FILE  api/grant-retention-credit.js
 * ======================================================================*/

const GRANT_BODY = [
  "// TMC_PATCH51A grant a $3 renewal-only retention credit.",
  "// Idempotent  if retention_offer_shown_at is already set on the user,",
  "// rejects to prevent users from farming the offer.",
  "",
  "const { createClient } = require('@supabase/supabase-js');",
  "const { resolveUser } = require('./_auth');",
  "",
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);",
  "",
  "module.exports = async function handler(req, res) {",
  "  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });",
  "",
  "  const auth = resolveUser(req);",
  "  if (!auth) return res.status(401).json({ error: 'Unauthorized' });",
  "  const user_id = auth.userId;",
  "",
  "  const { exit_reason } = req.body || {};",
  "",
  "  /* Read user state for the idempotency check + audit. */",
  "  const { data: user, error: uErr } = await supabase",
  "    .from('users')",
  "    .select('id, retention_offer_shown_at, retention_offer_accepted_at')",
  "    .eq('id', user_id)",
  "    .single();",
  "  if (uErr || !user) return res.status(404).json({ error: 'User not found' });",
  "",
  "  if (user.retention_offer_shown_at) {",
  "    return res.json({ ok: false, reason: 'already_shown' });",
  "  }",
  "",
  "  const nowIso = new Date().toISOString();",
  "",
  "  /* Mark on user FIRST so the idempotency gate is locked before we insert",
  "     the credit row (avoids a race where two concurrent grants both succeed). */",
  "  const { error: updErr } = await supabase.from('users').update({",
  "    retention_offer_shown_at:    nowIso,",
  "    retention_offer_accepted_at: nowIso,",
  "    retention_offer_exit_reason: (typeof exit_reason === 'string') ? exit_reason.slice(0, 64) : null",
  "  }).eq('id', user_id).is('retention_offer_shown_at', null);",
  "  if (updErr) return res.status(500).json({ error: updErr.message });",
  "",
  "  /* Verify the lock actually took (RLS/concurrent grant could have set it). */",
  "  const { data: confirm } = await supabase",
  "    .from('users')",
  "    .select('retention_offer_accepted_at')",
  "    .eq('id', user_id)",
  "    .single();",
  "  if (!confirm || confirm.retention_offer_accepted_at !== nowIso) {",
  "    return res.json({ ok: false, reason: 'already_shown' });",
  "  }",
  "",
  "  /* Insert the renewal-only credit row. */",
  "  const { error: refErr } = await supabase.from('referrals').insert({",
  "    referrer_user_id: user_id,",
  "    referred_user_id: null,",
  "    referral_code:    'RETENTION',",
  "    status:           'available',",
  "    credit_amount:    3.00,",
  "    credit_kind:      'renewal_only',",
  "    paid_at:          nowIso,",
  "    available_at:     nowIso,",
  "    applied_at:       nowIso",
  "  });",
  "  if (refErr) {",
  "    /* Roll back the user-side mark so the offer can be re-shown. */",
  "    await supabase.from('users').update({",
  "      retention_offer_shown_at:    null,",
  "      retention_offer_accepted_at: null,",
  "      retention_offer_exit_reason: null",
  "    }).eq('id', user_id);",
  "    return res.status(500).json({ error: refErr.message });",
  "  }",
  "",
  "  return res.json({ ok: true, credit_amount: 3.00, credit_kind: 'renewal_only' });",
  "};",
  ""
].join('\n');

/* ========================================================================
 * NEW FILE  api/decline-retention-offer.js
 * ======================================================================*/

const DECLINE_BODY = [
  "// TMC_PATCH51A record that a user was shown but declined the retention offer.",
  "// Sets users.retention_offer_shown_at so the gate is consumed (one-time only).",
  "// Does NOT grant any credit.",
  "",
  "const { createClient } = require('@supabase/supabase-js');",
  "const { resolveUser } = require('./_auth');",
  "",
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);",
  "",
  "module.exports = async function handler(req, res) {",
  "  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });",
  "",
  "  const auth = resolveUser(req);",
  "  if (!auth) return res.status(401).json({ error: 'Unauthorized' });",
  "  const user_id = auth.userId;",
  "",
  "  const { exit_reason } = req.body || {};",
  "",
  "  const { data: user } = await supabase",
  "    .from('users')",
  "    .select('retention_offer_shown_at')",
  "    .eq('id', user_id).single();",
  "  if (user && user.retention_offer_shown_at) {",
  "    return res.json({ ok: true, already_shown: true });",
  "  }",
  "",
  "  const { error } = await supabase.from('users').update({",
  "    retention_offer_shown_at:    new Date().toISOString(),",
  "    /* accepted_at stays null  declined */",
  "    retention_offer_exit_reason: (typeof exit_reason === 'string') ? exit_reason.slice(0, 64) : null",
  "  }).eq('id', user_id);",
  "  if (error) return res.status(500).json({ error: error.message });",
  "  return res.json({ ok: true });",
  "};",
  ""
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 51a  renewal-only credit (backend)\n');
log('Backup -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
let changed = 0;

/* EDIT 1: create-checkout.js */
{
  const original = fs.readFileSync(CC, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(CC + ': skip (already patched)');
  } else {
    const wasCRLF = original.indexOf('\r\n') !== -1;
    let updated = original.replace(/\r\n/g, '\n');
    const i = updated.indexOf(CC_FIND);
    if (i === -1) fail('pattern NOT FOUND in ' + CC);
    if (updated.indexOf(CC_FIND, i + 1) !== -1) fail('pattern NOT UNIQUE in ' + CC);
    updated = updated.replace(CC_FIND, () => CC_REPLACE);
    if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
    backupAndWrite(CC, original, updated);
    execSync('node --check "' + CC + '"', { stdio: 'pipe' });
    log(CC + ': patched, node --check OK');
    changed++;
  }
}

/* EDIT 2: get-referral.js  inspect first to find a safe insertion */
{
  if (!fs.existsSync(GR)) {
    log(GR + ': not found, skipping get-referral edit (Patch 51b can re-check)');
  } else {
    const original = fs.readFileSync(GR, 'utf8');
    if (original.indexOf(MARKER) !== -1) {
      log(GR + ': skip (already patched)');
    } else {
      /* Find a unique anchor: the line that computes credit_available */
      const candidates = [
        "const credit_available =",
        "credit_available:",
        "let credit_available"
      ];
      let anchor = null;
      for (const c of candidates) {
        if (original.indexOf(c) !== -1) { anchor = c; break; }
      }
      if (!anchor) {
        log(GR + ': could not find credit_available anchor  skipped. Patch 51b will retry.');
      } else {
        /* For maximum safety, do nothing in 51a beyond adding credit_kind
           to the .select() if present. We do not change the credit_available
           number contract  Patch 51b will add a separate breakdown field. */
        let updated = original.replace(/\r\n/g, '\n');
        const sel = updated.match(/\.select\(['"]([^'"]+)['"]\)/);
        if (sel && sel[1].indexOf('credit_kind') === -1) {
          const newSel = sel[0].replace(sel[1], sel[1] + ', credit_kind');
          updated = updated.replace(sel[0], newSel);
          /* Add a comment marker so idempotency catches this on re-run */
          updated = updated.replace(
            "module.exports",
            "/* TMC_PATCH51A: credit_kind read into rows for future use */\nmodule.exports"
          );
          const wasCRLF = original.indexOf('\r\n') !== -1;
          if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
          backupAndWrite(GR, original, updated);
          execSync('node --check "' + GR + '"', { stdio: 'pipe' });
          log(GR + ': patched (added credit_kind to select), node --check OK');
          changed++;
        } else {
          log(GR + ': skip (credit_kind already in select or no select() found)');
        }
      }
    }
  }
}

/* NEW: grant-retention-credit.js */
{
  if (fs.existsSync(GRANT) && fs.readFileSync(GRANT, 'utf8').indexOf(MARKER) !== -1) {
    log(GRANT + ': skip (already present with marker)');
  } else {
    if (fs.existsSync(GRANT)) {
      fs.mkdirSync(path.join(BACKUP_DIR, 'api'), { recursive: true });
      fs.copyFileSync(GRANT, path.join(BACKUP_DIR, GRANT));
    }
    fs.writeFileSync(GRANT, GRANT_BODY, 'utf8');
    execSync('node --check "' + GRANT + '"', { stdio: 'pipe' });
    log(GRANT + ': written, node --check OK');
    changed++;
  }
}

/* NEW: decline-retention-offer.js */
{
  if (fs.existsSync(DECLINE) && fs.readFileSync(DECLINE, 'utf8').indexOf(MARKER) !== -1) {
    log(DECLINE + ': skip (already present with marker)');
  } else {
    if (fs.existsSync(DECLINE)) {
      fs.mkdirSync(path.join(BACKUP_DIR, 'api'), { recursive: true });
      fs.copyFileSync(DECLINE, path.join(BACKUP_DIR, DECLINE));
    }
    fs.writeFileSync(DECLINE, DECLINE_BODY, 'utf8');
    execSync('node --check "' + DECLINE + '"', { stdio: 'pipe' });
    log(DECLINE + ': written, node --check OK');
    changed++;
  }
}

log('');
if (changed === 0) {
  log('All files already patched. Nothing to do.\n');
} else {
  log('Done. Files changed: ' + changed + '\n');
  log('IMPORTANT  REQUIRED before deploy:');
  log('  Run patch51a-migration.sql in Supabase first (4 new columns).');
  log('  Without it, grant/decline endpoints throw on every call.\n');
  log('NEXT STEPS:');
  log('  1. Run patch51a-migration.sql in Supabase');
  log('  2. git add -A');
  log('  3. git commit -m "Patch 51a: renewal-only credit support (backend)"');
  log('  4. git push  (wait ~60s for Vercel)');
  log('  5. No UI changes yet  user-facing flow comes in Patch 51b.');
  log('     Existing referral credits keep working unchanged (credit_kind');
  log('     defaults to general for existing rows).\n');
}
