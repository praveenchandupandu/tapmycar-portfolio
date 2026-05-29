/* ============================================================================
 * TapMyCar  Patch 43  fix referral codes at registration
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch43-referrals.js
 *
 * Two bugs fixed:
 *
 *   1. redeem-code.js rejected referral codes (TMC-XXXXXX) with "Invalid
 *      format" because it only accepted premium gift codes (TMC-PREM-XXXXXX).
 *      Now it accepts both: branches on format, premium path unchanged.
 *
 *   2. users.referred_by was never set during registration, so even if a
 *      friend got past bug 1 the referrer would never be credited when the
 *      friend later upgraded. The new referral path writes referred_by so
 *      stripe-webhook can credit the referrer at purchase time.
 *
 * Files modified:
 *
 *   api/redeem-code.js
 *     - Adds REFERRAL_FORMAT regex (TMC-XXXXXX, 6 alphanumeric).
 *     - Adds a referral branch BEFORE the existing premium-format check:
 *         * Looks up the referrer by users.referral_code
 *         * Rejects self-referral (you can't use your own code)
 *         * Idempotent if the user already used this same referral code
 *         * Rejects if they previously used a DIFFERENT referral code
 *         * Sets users.referred_by  so the stripe-webhook credit fires
 *         * Returns success with type:'referral' for the UI to handle
 *     - Updates the format-error message to mention both formats.
 *
 *   public/welcome.html
 *     - Success branch now handles data.type === 'referral' with its own
 *       title and message ("X will earn a reward when you upgrade…").
 *
 * No DB changes — the columns referenced (referral_code, referred_by,
 * referral_count, referral_credits, referral_reward_pending) already exist
 * and are already read by other code paths.
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH43.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH43';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch43-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* ========================================================================
 * EDIT 1  api/redeem-code.js  — accept both formats, set referred_by
 * ======================================================================*/

const REDEEM = path.join('api', 'redeem-code.js');

/* 1a — add REFERRAL_FORMAT regex next to the existing CODE_FORMAT */
const RE_FMT_FIND  = "const CODE_FORMAT = /^TMC-PREM-[A-HJ-NP-Z2-9]{6}$/;";
const RE_FMT_REPLACE = [
  "const CODE_FORMAT = /^TMC-PREM-[A-HJ-NP-Z2-9]{6}$/;",
  "const REFERRAL_FORMAT = /^TMC-[A-HJ-NP-Z2-9]{6}$/; /* TMC_PATCH43_REFERRALS */"
].join('\n');

/* 1b — insert the referral branch + update the format-error message */
const RE_LOGIC_FIND = [
  "  const normalized = String(code).trim().toUpperCase();",
  "",
  "  if (!CODE_FORMAT.test(normalized)) {",
  "    return res.status(400).json({ error: 'Invalid code format. Expected TMC-PREM-XXXXXX.' });",
  "  }"
].join('\n');

const RE_LOGIC_REPLACE = [
  "  const normalized = String(code).trim().toUpperCase();",
  "",
  "  /* TMC_PATCH43_REFERRALS: handle TMC-XXXXXX referral codes. Premium",
  "     codes are TMC-PREM-XXXXXX (longer). The regex anchors guarantee the",
  "     two formats can't both match. Referral path returns directly here;",
  "     premium path continues unchanged below. */",
  "  if (REFERRAL_FORMAT.test(normalized)) {",
  "    const { data: referrer, error: refLookupErr } = await supabase",
  "      .from('users')",
  "      .select('id, name')",
  "      .eq('referral_code', normalized)",
  "      .maybeSingle();",
  "    if (refLookupErr) {",
  "      console.error('referral lookup error:', refLookupErr.message);",
  "      return res.status(500).json({ error: 'Lookup failed' });",
  "    }",
  "    if (!referrer) {",
  "      return res.status(404).json({ error: \"We couldn't find that referral code. Double-check the spelling.\" });",
  "    }",
  "    if (referrer.id === user_id) {",
  "      return res.status(400).json({ error: \"You can't use your own referral code.\" });",
  "    }",
  "    /* Check the user's current referred_by:",
  "         - same code already on file -> idempotent success",
  "         - different code on file    -> reject (one referrer per user) */",
  "    const { data: u } = await supabase",
  "      .from('users')",
  "      .select('referred_by')",
  "      .eq('id', user_id)",
  "      .single();",
  "    if (u && u.referred_by) {",
  "      if (u.referred_by === normalized) {",
  "        return res.status(200).json({",
  "          success: true,",
  "          type: 'referral',",
  "          alreadyRedeemed: true,",
  "          referrer_name: referrer.name || 'your friend'",
  "        });",
  "      }",
  "      return res.status(400).json({ error: \"You've already used a referral code on this account.\" });",
  "    }",
  "    /* Set referred_by so stripe-webhook credits the referrer when this",
  "       user buys a paid plan. This is the missing link bug 2 fixes. */",
  "    const { error: updErr } = await supabase",
  "      .from('users')",
  "      .update({ referred_by: normalized })",
  "      .eq('id', user_id);",
  "    if (updErr) {",
  "      console.error('referral set failed:', updErr.message);",
  "      return res.status(500).json({ error: 'Could not apply the referral code right now.' });",
  "    }",
  "    return res.status(200).json({",
  "      success: true,",
  "      type: 'referral',",
  "      referrer_name: referrer.name || 'your friend'",
  "    });",
  "  }",
  "",
  "  if (!CODE_FORMAT.test(normalized)) {",
  "    return res.status(400).json({ error: 'Invalid code format. Expected TMC-PREM-XXXXXX or TMC-XXXXXX.' });",
  "  }"
].join('\n');

/* ========================================================================
 * EDIT 2  public/welcome.html  — referral success UI
 * ======================================================================*/

const WELCOME = path.join('public', 'welcome.html');

const WC_FIND = [
  "    if (data && data.success) {",
  "      // Clear pending code so we don't redeem it again on dashboard load",
  "      localStorage.removeItem('tmc_pending_code');",
  "      // Customize success message for the alreadyRedeemed case (idempotency)",
  "      if (data.alreadyRedeemed) {",
  "        document.getElementById('success-title').textContent = 'Already activated';",
  "        document.getElementById('success-message').textContent = \"You've already redeemed this code. Scan your sticker to activate it on your account.\";",
  "      }",
  "      showState('success');",
  "      return;",
  "    }"
].join('\n');

const WC_REPLACE = [
  "    if (data && data.success) {",
  "      // Clear pending code so we don't redeem it again on dashboard load",
  "      localStorage.removeItem('tmc_pending_code');",
  "      if (data.type === 'referral') {",
  "        /* TMC_PATCH43_REFERRALS: referral codes don't grant the user a plan.",
  "           The friend earns a reward later when this user upgrades to paid. */",
  "        var refName = data.referrer_name || 'your friend';",
  "        document.getElementById('success-title').textContent = data.alreadyRedeemed ? 'Already applied' : 'Referral applied';",
  "        document.getElementById('success-message').textContent =",
  "          (data.alreadyRedeemed ? \"This referral was already applied to your account. \" : \"Thanks! \") +",
  "          refName + \" will earn a reward when you upgrade to a paid plan.\";",
  "      } else if (data.alreadyRedeemed) {",
  "        document.getElementById('success-title').textContent = 'Already activated';",
  "        document.getElementById('success-message').textContent = \"You've already redeemed this code. Scan your sticker to activate it on your account.\";",
  "      }",
  "      showState('success');",
  "      return;",
  "    }"
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 43  fix referral codes at registration');
log('Backup -> ' + BACKUP_DIR + '\n');

const FILES = [
  { path: REDEEM,  edits: [
      { label: 'add REFERRAL_FORMAT regex',  find: RE_FMT_FIND,   replace: RE_FMT_REPLACE },
      { label: 'insert referral branch',     find: RE_LOGIC_FIND, replace: RE_LOGIC_REPLACE }
  ]},
  { path: WELCOME, edits: [
      { label: 'referral success message',   find: WC_FIND,       replace: WC_REPLACE }
  ]}
];

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

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

  for (const e of F.edits) {
    const i = updated.indexOf(e.find);
    if (i === -1) fail('pattern NOT FOUND in ' + F.path + '  [' + e.label + ']');
    if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE in ' + F.path + '  [' + e.label + ']');
    updated = updated.replace(e.find, () => e.replace);
  }
  if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
  planned.push({ file: F.path, original, updated });
  log(F.path + ': ready (' + F.edits.length + ' edits)');
}

if (planned.length === 0) {
  log('\nAll files already patched. Nothing to do.\n');
  process.exit(0);
}

for (const p of planned) backupAndWrite(p.file, p.original, p.updated);

let checkFailed = null;
for (const p of planned) {
  try {
    if (p.file.endsWith('.js')) {
      execSync('node --check "' + p.file + '"', { stdio: 'pipe' });
    } else if (p.file.endsWith('.html')) {
      /* extract the redeemCode script block and check it */
      const s = p.updated;
      const i = s.indexOf('async function redeemCode');
      if (i !== -1) {
        const a = s.lastIndexOf('<script>', i) + 8;
        const b = s.indexOf('</script>', i);
        fs.writeFileSync('/tmp/p43-chk.js', s.slice(a, b));
        execSync('node --check /tmp/p43-chk.js', { stdio: 'pipe' });
      }
    }
  } catch (e) {
    checkFailed = { file: p.file, err: String(e.stderr || e.message) };
    break;
  }
}

if (checkFailed) {
  for (const p of planned) fs.writeFileSync(p.file, p.original, 'utf8');
  fail('syntax check FAILED for ' + checkFailed.file
    + '  ALL files restored.\n' + checkFailed.err);
}

log('   - syntax check: OK for all ' + planned.length + ' files');
log('\nDone. Files changed: ' + planned.length + (skipped ? ('  (' + skipped + ' skipped)') : '') + '\n');

log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 43: fix referral codes at registration"');
log('  3. git push  (wait ~60s for Vercel)');
log('  4. Test with your friend: have them retry signup with the same code.');
log('     They should now get a green "Referral applied" screen.\n');
