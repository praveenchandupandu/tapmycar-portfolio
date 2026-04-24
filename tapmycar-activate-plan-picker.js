/**
 * tapmycar-activate-plan-picker.js
 * ---------------------------------------------------------------
 * Adds Standard/Premium plan picker + "pay everything today"
 * prepay toggle to public/activate.html (step 5 — payment step).
 *
 * WHAT THIS CHANGES
 *   1. Adds new CSS (plan cards + toggle switch) to the <style>
 *      block. Reuses your existing --or / --orl / --bd vars so the
 *      look matches the rest of the page.
 *   2. Replaces STEP 5 HTML with:
 *        - Plan picker: Standard ($9.99/yr) vs Premium ($19.99/yr,
 *          "Best for families" badge)
 *        - Prepay toggle row (off = $1 today, on = everything today)
 *        - Dynamic order summary (updates with plan + toggle)
 *        - Dynamic consent text
 *        - Dynamic "Pay $X — Activate Tag" button
 *   3. Updates processPayment() to send the user's selection:
 *        plan: 'standard'  ->  plan: selectedPlan
 *        prepay: false     ->  prepay: prepayEnabled
 *   4. On payment errors, button text resets via updatePaymentUI()
 *      (so it shows the CURRENT amount, not hardcoded $1).
 *   5. Injects plan-picker state + update function into the page JS.
 *   6. Copies public/activate.html -> root activate.html (your sync
 *      rule).
 *
 * WHAT THIS DOES NOT CHANGE
 *   - Steps 1-4 (scan/result/vehicle) — untouched
 *   - api/create-checkout.js — already supports both plans + prepay
 *   - Any other page or API
 *
 * HOW TO RUN (PowerShell):
 *   1. git checkout -b backup-before-plan-picker
 *      git checkout main
 *   2. node tapmycar-activate-plan-picker.js
 *   3. git diff public/activate.html   # sanity check
 *   4. git add -A
 *      git commit -m "feat(activate): plan picker + prepay toggle on payment step"
 *      git push
 *   5. Wait ~60s, open tapmycar.io in incognito, test activate flow
 * ---------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC_FILE = path.join(ROOT, 'public', 'activate.html');
const ROOT_FILE   = path.join(ROOT, 'activate.html');

if (!fs.existsSync(PUBLIC_FILE)) {
  console.error('[FAIL] Could not find public/activate.html');
  process.exit(1);
}

let content = fs.readFileSync(PUBLIC_FILE, 'utf8');
const original = content;
let changes = 0;

const section = (t) => console.log('\n=== ' + t + ' ===');
const ok      = (m) => { console.log('  [OK] ' + m); changes++; };
const skip    = (m) => console.log('  [skip] ' + m);
const fail    = (m) => { console.error('  [FAIL] ' + m); process.exit(1); };

console.log('========================================================');
console.log('  activate.html — plan picker + prepay toggle');
console.log('========================================================');

// ────────────────────────────────────────────────────────────────
// 1. Add new CSS block (idempotent via marker)
// ────────────────────────────────────────────────────────────────
section('STEP 1 — Inject CSS for plan picker + toggle switch');
const CSS_MARKER = '/* === PLAN PICKER & PREPAY TOGGLE === */';
const CSS_BLOCK = `${CSS_MARKER}
.picker-label{font-size:11px;font-weight:700;color:var(--gy);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px}
.plan-card{position:relative;background:var(--gbl);border:1.5px solid var(--bd);border-radius:14px;padding:14px 48px 14px 16px;margin-bottom:10px;cursor:pointer;transition:border-color .2s,background .2s}
.plan-card.selected{border-color:var(--or);background:var(--orl)}
.plan-card .plan-badge{position:absolute;top:-8px;left:14px;background:var(--bk);color:#fff;font-size:9px;font-weight:700;padding:3px 9px;border-radius:10px;letter-spacing:.04em;text-transform:uppercase}
.plan-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:4px}
.plan-name{font-size:15px;font-weight:800;color:var(--bk)}
.plan-price{font-size:13px;font-weight:700;color:var(--or);white-space:nowrap}
.plan-price span{font-size:10px;font-weight:500;color:var(--gy);margin-left:2px}
.plan-sub{font-size:11px;color:var(--gy);line-height:1.5}
.plan-radio{position:absolute;top:16px;right:14px;width:20px;height:20px;border:2px solid var(--bd);border-radius:50%;display:flex;align-items:center;justify-content:center;background:#fff}
.plan-card.selected .plan-radio{border-color:var(--or);background:var(--or)}
.plan-card.selected .plan-radio::after{content:'';width:8px;height:8px;border-radius:50%;background:#fff}
.prepay-row{display:flex;align-items:center;justify-content:space-between;background:var(--gbl);border:1px solid var(--bd);border-radius:12px;padding:12px 14px;gap:12px}
.prepay-text{flex:1}
.prepay-title{font-size:13px;font-weight:700;color:var(--bk);margin-bottom:2px}
.prepay-desc{font-size:11px;color:var(--gy);line-height:1.4}
.switch{position:relative;display:inline-block;width:42px;height:24px;flex-shrink:0}
.switch input{opacity:0;width:0;height:0}
.slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#D1D5DB;border-radius:24px;transition:.2s}
.slider:before{position:absolute;content:"";height:18px;width:18px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.switch input:checked + .slider{background:var(--or)}
.switch input:checked + .slider:before{transform:translateX(18px)}
`;

if (content.includes(CSS_MARKER)) {
  skip('CSS already injected — leaving as-is');
} else if (content.includes('</style>')) {
  // Use function replacement to avoid $ pattern interpretation
  content = content.replace('</style>', () => CSS_BLOCK + '</style>');
  ok('CSS block injected before </style>');
} else {
  fail('Could not find </style> to inject CSS');
}

// ────────────────────────────────────────────────────────────────
// 2. Replace STEP 5 (PAYMENT) with new picker-enabled version
// ────────────────────────────────────────────────────────────────
section('STEP 2 — Replace STEP 5: PAYMENT block');

const NEW_STEP5 = `<!-- ═══ STEP 5: PAYMENT ═══ -->
<div class="step-view" id="step-payment">
  <div class="nav"><div class="bk" onclick="showStep('vehicle')"><div class="bkb"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></div><span class="bk-label">Activate tag</span></div></div>
  <div class="chev"></div>
  <div style="flex:1;padding:20px;display:flex;flex-direction:column;gap:14px;overflow-y:auto">

    <div>
      <div class="picker-label">Choose your plan</div>
      <div class="plan-card selected" id="plan-standard" onclick="selectPlan('standard')">
        <div class="plan-top">
          <div class="plan-name">Standard</div>
          <div class="plan-price">$9.99<span>/yr</span></div>
        </div>
        <div class="plan-sub">1 vehicle · 10 masked calls/month · SMS alert on every scan</div>
        <div class="plan-radio"></div>
      </div>
      <div class="plan-card" id="plan-premium" onclick="selectPlan('premium')" style="margin-top:16px">
        <div class="plan-badge">Best for families</div>
        <div class="plan-top">
          <div class="plan-name">Premium</div>
          <div class="plan-price">$19.99<span>/yr</span></div>
        </div>
        <div class="plan-sub">3 vehicles · Unlimited calls · Scan map · Emergency contact · 3 family gift codes</div>
        <div class="plan-radio"></div>
      </div>
    </div>

    <div class="prepay-row">
      <div class="prepay-text">
        <div class="prepay-title">Pay everything today?</div>
        <div class="prepay-desc" id="prepay-desc">Off: Just $1 today. Sticker + annual billed later.</div>
      </div>
      <label class="switch">
        <input type="checkbox" id="prepay-toggle" onchange="updatePaymentUI()">
        <span class="slider"></span>
      </label>
    </div>

    <div class="card">
      <div style="font-size:11px;font-weight:700;color:var(--gy);text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px">Order summary</div>
      <div id="summary-lines"></div>
    </div>

    <div class="consent-auto">
      <div class="consent-check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>
      <div>
        <div style="font-size:13px;font-weight:700;color:#9A3800;margin-bottom:4px" id="consent-title">Auto-upgrade included</div>
        <div style="font-size:11px;color:#78350F;line-height:1.5" id="consent-desc">After 30 days, your plan upgrades to Standard ($9.99) and we ship a physical NFC + QR sticker to your address.</div>
        <div style="background:var(--gnl);border-radius:8px;padding:6px 10px;margin-top:8px"><div style="font-size:10px;color:#15803D;font-weight:600">Cancel anytime before day 30 — full refund if cancelled</div></div>
      </div>
    </div>

    <div class="field"><label>Shipping address <span style="color:var(--gy);font-weight:400">(for physical sticker on day 30)</span></label><input type="text" id="p-address" placeholder="123 Main St, New Britain CT 06051" autocomplete="street-address"></div>

    <div style="margin-top:auto">
      <button class="btn" id="pay-btn" onclick="processPayment()">Pay $1 — Activate Tag</button>
    </div>
  </div>
</div>

`;

const STEP5_RE = /<!-- ═══ STEP 5: PAYMENT ═══ -->[\s\S]*?(?=<!-- ═══ STEP 6: SUCCESS ═══ -->)/;
if (content.match(STEP5_RE)) {
  // Detect if already patched (look for a unique new element)
  if (content.includes('id="plan-standard"') && content.includes('id="prepay-toggle"')) {
    skip('STEP 5 already has the picker — leaving as-is');
  } else {
    // Use function replacement to avoid $ pattern interpretation (button text has "Pay $1")
    content = content.replace(STEP5_RE, () => NEW_STEP5);
    ok('STEP 5 replaced with picker + prepay toggle UI');
  }
} else {
  fail('Could not find STEP 5 markers — file state unexpected');
}

// ────────────────────────────────────────────────────────────────
// 3. Update processPayment() API call params
// ────────────────────────────────────────────────────────────────
section('STEP 3 — Wire payment submission to selected plan + prepay');

const OLD_PLAN = "plan: 'standard',";
const NEW_PLAN = "plan: selectedPlan,";
if (content.includes(OLD_PLAN)) {
  content = content.replace(OLD_PLAN, NEW_PLAN);
  ok("Replaced plan: 'standard' → plan: selectedPlan");
} else if (content.includes(NEW_PLAN)) {
  skip('plan param already wired to selectedPlan');
} else {
  fail("Could not find `plan: 'standard',` in processPayment — check file state");
}

const OLD_PREPAY = 'prepay: false,';
const NEW_PREPAY = 'prepay: prepayEnabled,';
if (content.includes(OLD_PREPAY)) {
  content = content.replace(OLD_PREPAY, NEW_PREPAY);
  ok('Replaced prepay: false → prepay: prepayEnabled');
} else if (content.includes(NEW_PREPAY)) {
  skip('prepay param already wired to prepayEnabled');
} else {
  fail('Could not find `prepay: false,` in processPayment — check file state');
}

// ────────────────────────────────────────────────────────────────
// 4. Update error-path button text resets to use updatePaymentUI()
//    (so button shows correct amount for selected plan, not hardcoded $1)
// ────────────────────────────────────────────────────────────────
section('STEP 4 — Make error-path button reset reflect current plan');

// Captures the indent from the second line so we preserve it (works for both
// the if/else branch [6 spaces] and the catch branch [4 spaces])
const RESET_PATTERN = /btn\.textContent = 'Pay \$1 — Activate Tag';\r?\n([ \t]+)btn\.disabled = false;/g;
const RESET_REPLACEMENT = "btn.disabled = false;\n$1updatePaymentUI();";
const resetMatches = content.match(RESET_PATTERN);
if (resetMatches && resetMatches.length > 0) {
  content = content.replace(RESET_PATTERN, RESET_REPLACEMENT);
  ok(`Updated ${resetMatches.length} error-path button reset(s) to use updatePaymentUI()`);
} else if (/btn\.disabled = false;\r?\n[ \t]+updatePaymentUI\(\);/.test(content)) {
  skip('Error-path resets already using updatePaymentUI');
} else {
  console.log('  [warn] Could not find error-path button resets — likely already patched or structure changed (non-fatal)');
}

// ────────────────────────────────────────────────────────────────
// 5. Inject plan picker state + updatePaymentUI() function
// ────────────────────────────────────────────────────────────────
section('STEP 5 — Inject plan picker JS state + updatePaymentUI()');

const JS_MARKER = '// === PLAN PICKER & PREPAY STATE ===';
const JS_BLOCK = `${JS_MARKER}
var selectedPlan = 'standard';
var prepayEnabled = false;

function selectPlan(plan) {
  selectedPlan = plan;
  var std = document.getElementById('plan-standard');
  var prm = document.getElementById('plan-premium');
  if (std) std.classList.toggle('selected', plan === 'standard');
  if (prm) prm.classList.toggle('selected', plan === 'premium');
  updatePaymentUI();
}

function updatePaymentUI() {
  var toggle = document.getElementById('prepay-toggle');
  prepayEnabled = toggle ? toggle.checked : false;
  var isStd = selectedPlan === 'standard';
  var stickerPrice = isStd ? 9.99 : 24.99;
  var annualPrice  = isStd ? 9.99 : 19.99;
  var planName     = isStd ? 'Standard' : 'Premium';
  var stickerLabel = isStd ? 'Standard sticker' : 'Premium 3-sticker bundle';

  // Prepay description
  var prepayDesc = document.getElementById('prepay-desc');
  if (prepayDesc) {
    if (prepayEnabled) {
      var total = (1 + stickerPrice + annualPrice).toFixed(2);
      prepayDesc.textContent = 'On: Pay $' + total + ' today. No charges on day 30 or day 60.';
    } else {
      prepayDesc.textContent = 'Off: Just $1 today. Sticker + annual billed later.';
    }
  }

  // Order summary lines
  var lines = document.getElementById('summary-lines');
  if (lines) {
    var html = '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:.5px solid var(--bd)">' +
      '<div style="font-size:14px;color:var(--bk);font-weight:500">eTag activation</div>' +
      '<div style="font-size:14px;font-weight:700;color:var(--bk)">$1.00</div></div>';
    if (prepayEnabled) {
      html += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:.5px solid var(--bd)">' +
        '<div style="font-size:14px;color:var(--bk);font-weight:500">' + stickerLabel + '</div>' +
        '<div style="font-size:14px;font-weight:700;color:var(--bk)">$' + stickerPrice.toFixed(2) + '</div></div>' +
        '<div style="display:flex;justify-content:space-between;padding:8px 0">' +
        '<div style="font-size:14px;color:var(--bk);font-weight:500">Year 1 ' + planName + ' annual</div>' +
        '<div style="font-size:14px;font-weight:700;color:var(--bk)">$' + annualPrice.toFixed(2) + '</div></div>';
    } else {
      html += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:.5px solid var(--bd)">' +
        '<div style="font-size:12px;color:var(--gy)">Day 30: ' + stickerLabel + ' ships</div>' +
        '<div style="font-size:12px;color:var(--gy)">$' + stickerPrice.toFixed(2) + '</div></div>' +
        '<div style="display:flex;justify-content:space-between;padding:8px 0">' +
        '<div style="font-size:12px;color:var(--gy)">Day 60: ' + planName + ' annual begins</div>' +
        '<div style="font-size:12px;color:var(--gy)">$' + annualPrice.toFixed(2) + '/yr</div></div>';
    }
    lines.innerHTML = html;
  }

  // Consent text
  var consentDesc = document.getElementById('consent-desc');
  if (consentDesc) {
    if (prepayEnabled) {
      consentDesc.textContent = 'Everything paid today. Your ' + (isStd ? 'Standard sticker' : '3 Premium stickers') + ' will ship in 2-3 business days. Year 1 is fully paid — no further charges until year 2.';
    } else {
      consentDesc.textContent = 'After 30 days, your plan upgrades to ' + planName + ' ($' + stickerPrice.toFixed(2) + ') and we ship a physical NFC + QR sticker' + (isStd ? '' : 's') + ' to your address.';
    }
  }

  // Pay button text (only if not mid-processing)
  var btn = document.getElementById('pay-btn');
  if (btn && !btn.disabled) {
    var payAmount = prepayEnabled ? (1 + stickerPrice + annualPrice).toFixed(2) : '1';
    btn.textContent = 'Pay $' + payAmount + ' — Activate Tag';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updatePaymentUI);
} else {
  updatePaymentUI();
}

`;

if (content.includes(JS_MARKER)) {
  skip('JS block already injected');
} else {
  // Inject before `function showStep(id)` which we confirmed exists in the script
  const ANCHOR = 'function showStep(id) {';
  if (content.includes(ANCHOR)) {
    // CRITICAL: use function replacement. JS_BLOCK contains strings like 'Pay $' + total
    // If we use a string replacement, $' is interpreted as "everything after the match"
    // and would splat the entire HTML footer into every $' spot. Using a function is safe.
    content = content.replace(ANCHOR, () => JS_BLOCK + ANCHOR);
    ok('JS block (selectPlan + updatePaymentUI) injected');
  } else {
    fail('Could not find `function showStep(id) {` anchor to inject JS');
  }
}

// ────────────────────────────────────────────────────────────────
// 6. Write public/activate.html + sync to root/activate.html
// ────────────────────────────────────────────────────────────────
section('STEP 6 — Save files');

if (content === original) {
  console.log('  [info] No changes made (file was already up to date)');
} else {
  fs.writeFileSync(PUBLIC_FILE, content, 'utf8');
  ok('Saved public/activate.html');
  if (fs.existsSync(ROOT_FILE)) {
    fs.copyFileSync(PUBLIC_FILE, ROOT_FILE);
    ok('Synced to root activate.html');
  } else {
    console.log('  [info] No root activate.html to sync (that\'s fine)');
  }
}

// ────────────────────────────────────────────────────────────────
// Done
// ────────────────────────────────────────────────────────────────
console.log('\n========================================================');
console.log(`  DONE — ${changes} change(s) applied`);
console.log('========================================================');
console.log('\n  Next steps in PowerShell:');
console.log('    git diff public/activate.html');
console.log('    git add -A');
console.log('    git commit -m "feat(activate): plan picker + prepay toggle"');
console.log('    git push');
console.log('\n  Then test flow at tapmycar.io/activate.html:');
console.log('    - Scan a test tag');
console.log('    - Fill vehicle details');
console.log('    - On payment step: both plans clickable, toggle works');
console.log('    - Pay button amount updates as you switch options');
console.log('    - Complete checkout with test card 4242 4242 4242 4242');
console.log('');
