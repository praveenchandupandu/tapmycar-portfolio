/* ============================================================================
 * TapMyCar  Patch 47  renewal countdown UI
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch47-countdown.js
 *
 * Two things:
 *
 *   1. dashboard.html  small renewal-countdown card that appears ONLY when
 *      the user has an active subscription AND renewal is within 7 days.
 *      Visibility tiers:
 *        - 7 days down to 2 days  yellow accent ("Renews in 5 days")
 *        - 1 day                  orange accent ("Renews tomorrow")
 *        - 0 days                 red accent ("Renews today")
 *        - >7 days                hidden
 *        - no active subscription hidden (Patch 46 banner handles that case)
 *
 *   2. billing.html  always-on "N days from now" suffix next to the renewal
 *      date. So curious users can see exactly how many days are left, any
 *      day of the year.
 *
 * Backend change:
 *   api/get-dashboard.js  enrich the response with renewal_iso and
 *   next_amount_cents pulled from Stripe IF user has a subscription_id.
 *   Guarded; failures are non-fatal (logs + returns null fields).
 *
 * Frontend changes:
 *   public/dashboard.html  new card markup + render JS hook.
 *   public/billing.html    "(in N days)" suffix on the renewal date.
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH47_CD.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH47_CD';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch47-countdown-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const GD   = path.join('api', 'get-dashboard.js');
const DASH = path.join('public', 'dashboard.html');
const BILL = path.join('public', 'billing.html');

/* ========================================================================
 * EDIT 1  api/get-dashboard.js  add renewal_iso + next_amount_cents
 * ----------------------------------------------------------------------
 * We need a Stripe require at the top and a lookup block before the final
 * res.json(). We anchor on the final res.json() block specifically since
 * there are multiple in this file.
 * ======================================================================*/

const GD_REQUIRE_FIND = "const { createClient } = require('@supabase/supabase-js');";
const GD_REQUIRE_REPLACE = [
  "const { createClient } = require('@supabase/supabase-js');",
  "const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); /* TMC_PATCH47_CD */"
].join('\n');

/* Anchor on the final res.json (the one returning user, tags, scanCount,...) */
const GD_RESP_FIND = [
  "  res.json({",
  "    user,",
  "    tags: tags || [],",
  "    scanCount,",
  "    weekCount,",
  "    recentScans: recentScans || [],",
  "    premiumCodes",
  "  });",
  "};"
].join('\n');

const GD_RESP_REPLACE = [
  "  /* TMC_PATCH47_CD: enrich the response with renewal date and next charge",
  "     amount from Stripe. Non-fatal: any failure leaves the fields null. */",
  "  let renewal_iso = null;",
  "  let next_amount_cents = null;",
  "  if (user && user.subscription_id) {",
  "    try {",
  "      const sub = await stripe.subscriptions.retrieve(user.subscription_id);",
  "      if (sub && sub.current_period_end) {",
  "        renewal_iso = new Date(sub.current_period_end * 1000).toISOString();",
  "      }",
  "      if (sub && sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price) {",
  "        next_amount_cents = sub.items.data[0].price.unit_amount || null;",
  "      }",
  "    } catch (e) {",
  "      console.warn('TMC_PATCH47_CD: stripe sub lookup failed:', e && e.message);",
  "    }",
  "  }",
  "",
  "  res.json({",
  "    user,",
  "    tags: tags || [],",
  "    scanCount,",
  "    weekCount,",
  "    recentScans: recentScans || [],",
  "    premiumCodes,",
  "    renewal_iso,            /* TMC_PATCH47_CD */",
  "    next_amount_cents       /* TMC_PATCH47_CD */",
  "  });",
  "};"
].join('\n');

/* ========================================================================
 * EDIT 2  public/dashboard.html  new countdown card + render JS
 * ----------------------------------------------------------------------
 * Anchor: insert between the hero block and "<!-- 3. STATS ROW -->" comment.
 * ======================================================================*/

const DASH_CARD_FIND = "    <!-- 3. STATS ROW -->";

const DASH_CARD_REPLACE = [
  "    <!-- TMC_PATCH47_CD: renewal countdown card (hidden by default) -->",
  "    <div id=\"renewal-card\" style=\"display:none;border-radius:14px;padding:14px 16px;margin-bottom:14px;font-family:Inter,system-ui,sans-serif\">",
  "      <div style=\"font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:4px\" id=\"renewal-card-label\">Subscription renewal</div>",
  "      <div style=\"font-size:15px;font-weight:800;line-height:1.3\" id=\"renewal-card-title\">Renews in 7 days</div>",
  "      <div style=\"font-size:12px;margin-top:4px\" id=\"renewal-card-sub\">$9.99 will be charged to your card on file.</div>",
  "    </div>",
  "",
  "    <!-- 3. STATS ROW -->"
].join('\n');

/* The render JS: hook into the existing loadDashboard data flow. The cleanest
   place is to add a function that's called from the top of loadDashboard's
   success branch. To minimize risk, we add it as its OWN small block that
   runs on data arrival via a separate fetch — but that duplicates work. Better:
   we add it inside loadDashboard right after `const data = await res.json();`
   The existing function has that line. We anchor on a unique nearby line. */
const DASH_JS_FIND = "    if (data.recentScans && data.recentScans.length > 0) {";

const DASH_JS_REPLACE = [
  "    /* TMC_PATCH47_CD: renewal countdown card. Show only when",
  "       renewal_iso is set AND <= 7 days away. Three tiers (yellow / orange / red). */",
  "    (function () {",
  "      var card = document.getElementById('renewal-card');",
  "      if (!card) return;",
  "      var iso = data.renewal_iso;",
  "      if (!iso) { card.style.display = 'none'; return; }",
  "      var ms = new Date(iso).getTime() - Date.now();",
  "      var days = Math.ceil(ms / 86400000);",
  "      if (days > 7 || days < 0) { card.style.display = 'none'; return; }",
  "",
  "      var title = document.getElementById('renewal-card-title');",
  "      var sub   = document.getElementById('renewal-card-sub');",
  "      var label = document.getElementById('renewal-card-label');",
  "      var amt   = (data.next_amount_cents != null) ? ('$' + (data.next_amount_cents/100).toFixed(2)) : '';",
  "",
  "      var bg, border, txt, accent;",
  "      if (days === 0) {",
  "        bg = '#FEF2F2'; border = '#FCA5A5'; txt = '#7F1D1D'; accent = '#B91C1C';",
  "        title.textContent = 'Renews today';",
  "      } else if (days === 1) {",
  "        bg = '#FFF7ED'; border = '#FDBA74'; txt = '#7C2D12'; accent = '#C2410C';",
  "        title.textContent = 'Renews tomorrow';",
  "      } else {",
  "        bg = '#FEFCE8'; border = '#FCD34D'; txt = '#713F12'; accent = '#92400E';",
  "        title.textContent = 'Renews in ' + days + ' days';",
  "      }",
  "      card.style.background    = bg;",
  "      card.style.border        = '1px solid ' + border;",
  "      card.style.color         = txt;",
  "      label.style.color        = accent;",
  "      sub.textContent = amt ? (amt + ' will be charged to your card on file.') : 'Will be charged to your card on file.';",
  "      card.style.display = 'block';",
  "      card.style.cursor  = 'pointer';",
  "      card.onclick = function () { window.location.href = '/billing.html'; };",
  "    })();",
  "",
  "    if (data.recentScans && data.recentScans.length > 0) {"
].join('\n');

/* ========================================================================
 * EDIT 3  public/billing.html  "(in N days)" suffix on renewal date
 * ----------------------------------------------------------------------
 * Existing line:
 *   document.getElementById('b-renewal').textContent = fmtDate(data.renewal);
 * Change to compose date + days-from-now suffix.
 * ======================================================================*/

const BILL_FIND = "      document.getElementById('b-renewal').textContent = fmtDate(data.renewal);";

const BILL_REPLACE = [
  "      /* TMC_PATCH47_CD: always show days-from-now next to the renewal date. */",
  "      (function () {",
  "        var dateStr = fmtDate(data.renewal);",
  "        var ms = new Date(data.renewal).getTime() - Date.now();",
  "        var days = Math.ceil(ms / 86400000);",
  "        var suffix = '';",
  "        if (days > 1)        suffix = ' (in ' + days + ' days)';",
  "        else if (days === 1) suffix = ' (tomorrow)';",
  "        else if (days === 0) suffix = ' (today)';",
  "        document.getElementById('b-renewal').textContent = dateStr + suffix;",
  "      })();"
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 47  renewal countdown\n');
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
  if (patchFile(GD, [
    { label: 'get-dashboard: require stripe',     find: GD_REQUIRE_FIND, replace: GD_REQUIRE_REPLACE },
    { label: 'get-dashboard: enrich response',    find: GD_RESP_FIND,    replace: GD_RESP_REPLACE }
  ])) {
    execSync('node --check "' + GD + '"', { stdio: 'pipe' });
    log('   - node --check OK');
    changed++;
  }
  if (patchFile(DASH, [
    { label: 'dashboard: insert card markup',     find: DASH_CARD_FIND, replace: DASH_CARD_REPLACE },
    { label: 'dashboard: insert render JS',       find: DASH_JS_FIND,   replace: DASH_JS_REPLACE   }
  ])) {
    /* syntax-check the embedded script around our hook */
    const s = fs.readFileSync(DASH, 'utf8');
    const at = s.indexOf('TMC_PATCH47_CD: renewal countdown card.');
    if (at !== -1) {
      const a = s.lastIndexOf('<script>', at) + 8;
      const b = s.indexOf('</script>', at);
      fs.writeFileSync('/tmp/p47-cd-dash-chk.js', s.slice(a, b));
      execSync('node --check /tmp/p47-cd-dash-chk.js', { stdio: 'pipe' });
      log('   - dashboard.html embedded script: node --check OK');
    }
    changed++;
  }
  if (patchFile(BILL, [
    { label: 'billing: days-from-now suffix',     find: BILL_FIND, replace: BILL_REPLACE }
  ])) {
    /* syntax-check the embedded script around our hook */
    const s = fs.readFileSync(BILL, 'utf8');
    const at = s.indexOf('TMC_PATCH47_CD: always show days');
    if (at !== -1) {
      const a = s.lastIndexOf('<script>', at) + 8;
      const b = s.indexOf('</script>', at);
      fs.writeFileSync('/tmp/p47-cd-bill-chk.js', s.slice(a, b));
      execSync('node --check /tmp/p47-cd-bill-chk.js', { stdio: 'pipe' });
      log('   - billing.html embedded script: node --check OK');
    }
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
  log('  2. git commit -m \"Patch 47: renewal countdown on dashboard + billing\"');
  log('  3. git push  (wait ~60s for Vercel)');
  log('  4. Test  see the verification notes below.\n');
  log('TESTING:');
  log('  - Without a real Stripe subscription you cannot directly test the');
  log('    7d/1d/0d tiers. The CURRENT state (subscription_id NULL,');
  log('    promo-gift scenario) means dashboard.html shows the Patch 46');
  log('    yellow overdue banner only  no countdown card. That is correct.');
  log('  - On billing.html, the renewal section still says "No active');
  log('    subscription"  no countdown suffix either. That is correct.');
  log('  - To exercise the countdown UI you need a real Stripe subscription');
  log('    with current_period_end within 7 days. Stripe Test Clocks (Patch 49)');
  log('    is the proper test for this.\n');
}
