/* ============================================================================
 * TapMyCar  Patch 45b-fix  banner placement + checkbox UX + signups fix
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch45b-fix.js
 *
 * Four fixes on top of Patch 45a/45b:
 *
 *   1. pricing.html banner placement  the Patch 45b banner was inserting
 *      itself as the first child of <main>/<body>, which on pricing.html
 *      shoved into the header strip and broke the layout. Now it lives in
 *      its own clean strip just below the header.
 *
 *   2. pricing.html  checkbox default unchecked. User has to opt in
 *      to applying credit; default state is "save my credit for later."
 *
 *   3. pricing.html  the existing "Referral discount applied!"
 *      (discount-banner) was always-on if credits >= $3. Now it's tied to
 *      the new checkbox: hidden when unticked, visible when ticked. So
 *      both banners agree on the user's intent.
 *
 *   4. get-referral.js  SIGNED UP now counts every row (applied + pending
 *      + available + consumed). Previously it dropped to 0 the moment the
 *      friend paid, which is wrong  it should be a cumulative count.
 *      PAID stays as it was (pending + available + consumed).
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH45B_FIX.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH45B_FIX';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch45b-fix-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const PR = path.join('public', 'pricing.html');
const GR = path.join('api', 'get-referral.js');

/* ========================================================================
 * EDIT 1  pricing.html  replace the Patch 45b inline script wholesale
 * ----------------------------------------------------------------------
 * The Patch 45b script: (a) injected the banner as first child of main/body
 * which is the wrong spot, (b) default-checked the checkbox, (c) didn't talk
 * to the existing discount-banner. We rewrite it to fix all three.
 *
 * Anchor: the existing TMC_PATCH45B comment header inside <head>.
 * ======================================================================*/

const PR_FIND = [
  "<script>",
  "/* TMC_PATCH45B: pricing-page referral-credit banner + apply checkbox.",
  "   Fetches the user's available credit on load. If > 0, inserts a banner",
  "   above the plan cards with a checkbox (default ON). The checkout button",
  "   handlers read the checkbox state and pass apply_referral_credit through.",
  "   Free-flow responses ({ free:true, redirect }) are handled directly. */"
].join('\n');

const PR_REPLACE = [
  "<script>",
  "/* TMC_PATCH45B_FIX: pricing-page referral-credit banner + apply checkbox.",
  "   Fetches the user's available credit on load. If > 0, inserts a banner",
  "   into its OWN strip below the header (not into the header itself).",
  "   Checkbox is default UNCHECKED  user has to opt in to applying credit.",
  "   The pre-existing 'discount-banner' is also tied to this checkbox: when",
  "   the user ticks the box we show it; when unticked we hide it, so both",
  "   banners reflect the same intent. */"
].join('\n');

/* The actual logic block: we replace the entire IIFE so the placement,
   default state, and the discount-banner toggle are all in one place. */
const PR_LOGIC_FIND = [
  "(function () {",
  "  function inject(creditDollars) {",
  "    if (creditDollars <= 0) return;",
  "    var bar = document.createElement('div');",
  "    bar.id = 'tmc-refbar';",
  "    bar.style.cssText = 'background:linear-gradient(90deg,#DCFCE7,#BBF7D0);border:1px solid #86EFAC;border-radius:12px;padding:12px 14px;margin:12px 16px 0;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;gap:10px';",
  "    bar.innerHTML =",
  "      '<div style=\"flex:1\">' +",
  "        '<div style=\"font-size:13px;font-weight:800;color:#166534\">You have $' + creditDollars.toFixed(2) + ' in referral credit</div>' +",
  "        '<label style=\"display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;color:#15803D;font-weight:600;cursor:pointer\">' +",
  "          '<input type=\"checkbox\" id=\"tmc-apply-credit\" checked style=\"width:14px;height:14px;cursor:pointer\">' +",
  "          'Apply at checkout' +",
  "        '</label>' +",
  "      '</div>';",
  "    var anchor = document.querySelector('main') || document.body.firstElementChild || document.body;",
  "    if (anchor && anchor.firstChild) anchor.insertBefore(bar, anchor.firstChild);",
  "    else document.body.appendChild(bar);",
  "  }"
].join('\n');

const PR_LOGIC_REPLACE = [
  "(function () {",
  "  function setApplied(on, dollars) {",
  "    /* Mirror the new checkbox state into the legacy window.__refDiscount",
  "       and into the pre-existing 'discount-banner' visibility, so both",
  "       banners reflect the same user intent. */",
  "    try {",
  "      window.__refDiscount = on ? (dollars || 0) : 0;",
  "      var legacy = document.getElementById('discount-banner');",
  "      if (legacy) legacy.style.display = on ? 'block' : 'none';",
  "    } catch (e) {}",
  "  }",
  "  function inject(creditDollars) {",
  "    if (creditDollars <= 0) return;",
  "    /* Place the banner in its own dedicated strip between the header",
  "       and the main content. Anchor: find an element whose next sibling",
  "       is the 'Simple pricing' heading, OR fall back to the main wrap. */",
  "    var bar = document.createElement('div');",
  "    bar.id = 'tmc-refbar';",
  "    bar.style.cssText = 'background:linear-gradient(90deg,#DCFCE7,#BBF7D0);border:1px solid #86EFAC;border-radius:12px;padding:12px 14px;margin:8px 16px 12px;font-family:Inter,system-ui,sans-serif';",
  "    bar.innerHTML =",
  "        '<div style=\"font-size:13px;font-weight:800;color:#166534\">You have $' + creditDollars.toFixed(2) + ' in referral credit</div>' +",
  "        '<label style=\"display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:#15803D;font-weight:600;cursor:pointer;user-select:none\">' +",
  "          '<input type=\"checkbox\" id=\"tmc-apply-credit\" style=\"width:16px;height:16px;cursor:pointer;accent-color:#16A34A\">' +",
  "          'Tick to apply $' + creditDollars.toFixed(2) + ' discount to your purchase' +",
  "        '</label>';",
  "    /* Find a good place: AFTER the header strip, BEFORE the main pricing",
  "       cards. The discount-banner div (id='discount-banner') is a great",
  "       anchor  it lives exactly where we want to be. */",
  "    var legacy = document.getElementById('discount-banner');",
  "    if (legacy && legacy.parentNode) {",
  "      legacy.parentNode.insertBefore(bar, legacy);",
  "    } else {",
  "      var mainEl = document.querySelector('main') || document.body;",
  "      mainEl.insertBefore(bar, mainEl.firstChild);",
  "    }",
  "    /* Hook the checkbox: when ticked, show the legacy banner + set the",
  "       discount value; when unticked, hide it. Default state: UNCHECKED. */",
  "    var cb = document.getElementById('tmc-apply-credit');",
  "    if (cb) {",
  "      setApplied(false, creditDollars); /* default state */",
  "      cb.addEventListener('change', function () {",
  "        setApplied(cb.checked, creditDollars);",
  "      });",
  "    }",
  "  }"
].join('\n');

/* ========================================================================
 * EDIT 2  api/get-referral.js  fix SIGNED UP count
 * ----------------------------------------------------------------------
 * Patch 45a's reducer:
 *   - applied -> signups += 1
 *   - pending/available/consumed -> confirmed += 1, NOT signups
 * Result: as soon as a friend pays, signups drops back to 0. Wrong.
 *
 * Correct meaning:
 *   - signups   = total who ever used my code (cumulative)
 *   - confirmed = of those, how many paid (== "Bought a plan")
 * Both should NEVER decrease over a friend's lifecycle.
 * ======================================================================*/

const GR_FIND = [
  "  let signups = 0, confirmed = 0, credit_available = 0, credit_pending = 0;",
  "  (rows || []).forEach(function (r) {",
  "    var amt = parseFloat(r.credit_amount) || 0;",
  "    if (r.status === 'applied') {",
  "      signups += 1;",
  "    } else if (r.status === 'pending') {",
  "      confirmed += 1;",
  "      if (r.available_at && r.available_at <= nowIso) credit_available += amt;",
  "      else                                            credit_pending += amt;",
  "    } else if (r.status === 'available') {",
  "      confirmed += 1;",
  "      credit_available += amt;",
  "    } else if (r.status === 'consumed') {",
  "      confirmed += 1;",
  "      /* consumed contributes to confirmed count but not to balances */",
  "    }",
  "    /* 'revoked' rows contribute to neither signups nor confirmed nor any balance */",
  "  });"
].join('\n');

const GR_REPLACE = [
  "  let signups = 0, confirmed = 0, credit_available = 0, credit_pending = 0;",
  "  (rows || []).forEach(function (r) {",
  "    var amt = parseFloat(r.credit_amount) || 0;",
  "    /* TMC_PATCH45B_FIX: signups is cumulative  every non-revoked row counts.",
  "       confirmed counts everyone who actually paid (any post-applied state). */",
  "    if (r.status === 'revoked') return;",
  "    signups += 1;",
  "    if (r.status === 'applied') {",
  "      /* signed up, hasn't paid yet  no credit movement */",
  "    } else if (r.status === 'pending') {",
  "      confirmed += 1;",
  "      if (r.available_at && r.available_at <= nowIso) credit_available += amt;",
  "      else                                            credit_pending += amt;",
  "    } else if (r.status === 'available') {",
  "      confirmed += 1;",
  "      credit_available += amt;",
  "    } else if (r.status === 'consumed') {",
  "      confirmed += 1;",
  "      /* consumed contributes to confirmed count but not to balances */",
  "    }",
  "  });"
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 45b-fix  banner placement + checkbox UX + signups fix');
log('Backup -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

function patchFile(file, edits) {
  if (!fs.existsSync(file)) fail('expected file not found: ' + file);
  const original = fs.readFileSync(file, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(file + ': skip (already patched)');
    return false;
  }
  const wasCRLF = original.indexOf('\r\n') !== -1;
  let updated = original.replace(/\r\n/g, '\n');
  for (const e of edits) {
    const i = updated.indexOf(e.find);
    if (i === -1) fail('pattern NOT FOUND in ' + file + '  [' + e.label + ']');
    if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE in ' + file + '  [' + e.label + ']');
    updated = updated.replace(e.find, () => e.replace);
  }
  if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
  backupAndWrite(file, original, updated);
  log(file + ': patched');
  return true;
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
let changed = 0;

try {
  if (patchFile(PR, [
    { label: 'pricing.html: marker comment',   find: PR_FIND,       replace: PR_REPLACE },
    { label: 'pricing.html: new IIFE logic',   find: PR_LOGIC_FIND, replace: PR_LOGIC_REPLACE }
  ])) {
    /* validate the injected <script> block parses */
    const s = fs.readFileSync(PR, 'utf8');
    const i = s.indexOf('TMC_PATCH45B_FIX: pricing-page');
    if (i !== -1) {
      const a = s.lastIndexOf('<script>', i) + 8;
      const b = s.indexOf('</script>', i);
      fs.writeFileSync('/tmp/p45b-fix-pr-chk.js', s.slice(a, b));
      execSync('node --check /tmp/p45b-fix-pr-chk.js', { stdio: 'pipe' });
      log('   - pricing.html script: node --check OK');
    }
    changed++;
  }
  if (patchFile(GR, [
    { label: 'get-referral: cumulative signups', find: GR_FIND, replace: GR_REPLACE }
  ])) {
    execSync('node --check "' + GR + '"', { stdio: 'pipe' });
    log('   - node --check OK');
    changed++;
  }
} catch (e) {
  fail(e && e.message);
}

log('');
if (changed === 0) {
  log('All files already patched. Nothing to do.\n');
} else {
  log('Done. Files changed: ' + changed + '\n');
  log('NEXT STEPS:');
  log('  1. git add -A');
  log('  2. git commit -m "Patch 45b-fix: banner placement + checkbox UX + signups"');
  log('  3. git push  (wait ~60s for Vercel)');
  log('  4. Hard-refresh /settings.html  SIGNED UP should now read 1.');
  log('  5. Hard-refresh /pricing.html  green banner sits between header');
  log('     and pricing cards, checkbox is UNTICKED by default. Tick it to');
  log('     see the existing "Referral discount applied!" banner appear and');
  log('     the plan prices drop. Untick to revert.\n');
}
