// ============================================================================
// TapMyCar — Patch 7 of 7: Activate.html SMS UI + Stripe session passthrough
//
// Concept: every tag activation needs fresh SMS OTP. Patch 5 created the
// backend gate. This patch wires the actual UI flow + closes the Stripe
// bypass where post-payment activation skipped the gate.
//
// REQUIRES: Patches 4, 5, 6 already applied locally.
// REQUIRES: Twilio Verify SMS confirmed working in production.
//
// What this patch does:
//
//   7.1  api/get-tag.js: bump activation session expiry from 5 min to 15 min
//        (per design Q1-A — Stripe checkout can take longer than 5 min if
//        user is slow, raising window prevents stale-session edge case)
//
//   7.2  public/activate.html — substantial changes:
//        a) Read ?token= URL parameter on page load. If present, auto-
//           process the token (skip QR scanner). Lets etag.html link
//           to /activate.html?token=TMC-ETxxxx
//        b) New STEP UI: 'phone-verify' between vehicle details and
//           payment/activation. Send code button, 6-digit input, 60s
//           resend cooldown, error display, masked-phone display.
//           Settings link for "wrong number" case.
//        c) New flow function flowAfterVehicle() decides:
//             - eTag activation (own claimed eTag): vehicle -> phone-verify -> activateEtag()
//             - Physical upgrade (paid user): vehicle -> phone-verify -> activatePhysicalSticker()
//             - Paid new physical: vehicle -> phone-verify -> payment -> Stripe -> webhook
//        d) New activateEtag() function: free eTag activation, no payment,
//           no eTag deactivation, just status flip with session_id.
//        e) Update activatePhysicalSticker() to pass activation_session_id
//        f) Update processPayment() to require SMS verification BEFORE
//           Stripe checkout, store session_id in localStorage as
//           tmc_pending_activation_session, send to create-checkout.
//        g) proceedToPayment() and proceedFromCarChoice() updated to
//           route through the new SMS verify step.
//
//   7.3  api/create-checkout.js: accept activation_session_id from body,
//        pass through to Stripe checkout metadata so the webhook can
//        retrieve and consume it after payment.
//
//   7.4  api/stripe-webhook.js: BEFORE activating a tag in checkout.session.
//        completed handler, read activation_session_id from metadata and
//        validate (not used, not expired, matches user_id). On invalid:
//        log error and do NOT activate the tag. On valid: consume (mark
//        used=true) then proceed with activation.
//
//        This closes the bypass where Stripe webhook skipped the
//        activation_sessions gate that get-tag.js enforces.
//
// Properties:
//   - Idempotent (re-running is a no-op via marker checks)
//   - Backups every touched file to backup-patch7-{timestamp}/
//   - Validates JS syntax with node --check
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch7-activate-ui.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch7-activate-ui.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch7-activate-ui.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch7-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const warn = (s) => console.log('  ! ' + s);
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}
function backup(file) {
  const rel = path.relative(ROOT, file);
  const dest = path.join(BACKUP_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function writeFile(p, content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}
function validateJs(p) {
  try {
    execSync('node --check "' + p + '"', { stdio: 'pipe' });
  } catch (e) {
    errExit('JS syntax error in ' + p + '\n' + e.stderr.toString());
  }
}
function tryReplace(content, oldStr, newStr) {
  if (content.includes(oldStr)) return content.replace(oldStr, newStr);
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF)) {
    const newCRLF = newStr.replace(/\n/g, '\r\n');
    return content.replace(oldCRLF, newCRLF);
  }
  return null;
}

log('');
log('TapMyCar Patch 7 \u2014 Activate.html SMS UI + Stripe passthrough');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_7 = 'TMC_PATCH7_ACTIVATE_SMS';

// ===========================================================================
// 7.1  Bump session expiry 5min -> 15min in get-tag.js
// ===========================================================================

log('7.1  get-tag.js: bump activation session expiry to 15 minutes');

{
  const file = path.join(API, 'get-tag.js');
  const content = readFile(file);

  if (content.includes('15 * 60 * 1000')) {
    skip('get-tag.js (already 15 min)');
  } else if (!content.includes('5 * 60 * 1000')) {
    warn('get-tag.js: 5min constant not found, skipping');
  } else {
    backup(file);
    const updated = content.replace('5 * 60 * 1000', '15 * 60 * 1000');
    writeFile(file, updated);
    validateJs(file);
    ok('get-tag.js: session expiry now 15 minutes');
  }
}

// ===========================================================================
// 7.2  activate.html — the main UI changes
// ===========================================================================

log('');
log('7.2  activate.html: SMS verify step + flow routing + URL token reading');

{
  const file = path.join(PUBLIC, 'activate.html');
  const content = readFile(file);

  if (content.includes(MARKER_7)) {
    skip('activate.html (already updated)');
  } else {
    backup(file);
    let updated = content;

    // ── 7.2.a  Insert phone-verify step UI right after vehicle step ────
    const vehicleStepClose = `<div style="margin-top:auto"><button class="btn" onclick="proceedToPayment()">Continue \u2192</button></div>
  </div>
</div>`;
    const phoneVerifyStep = `<div style="margin-top:auto"><button class="btn" onclick="proceedToPayment()">Continue \u2192</button></div>
  </div>
</div>

<!-- \u2550\u2550\u2550 ${MARKER_7} \u2014 STEP: PHONE VERIFY \u2550\u2550\u2550 -->
<div class="step-view" id="step-phone-verify">
  <div class="nav"><div class="bk" onclick="showStep('vehicle')"><div class="bkb"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></div><span class="bk-label">Verify your phone</span></div></div>
  <div class="chev"></div>
  <div style="flex:1;padding:20px;display:flex;flex-direction:column;gap:14px">
    <div style="font-size:18px;font-weight:800;color:var(--bk);margin-bottom:0">Verify your phone</div>
    <div style="font-size:13px;color:var(--gy);line-height:1.5">For your security, we'll text a 6-digit code to <span id="pv-masked-phone" style="font-weight:700;color:var(--bk)">your phone</span>. Enter it below to activate this tag.</div>

    <div id="pv-send-section" style="display:flex;flex-direction:column;gap:12px;margin-top:8px">
      <button class="btn" id="pv-send-btn" onclick="pvSendCode()">Send code via SMS</button>
      <div style="font-size:11px;color:var(--gy);text-align:center">Wrong number? <a href="/settings.html" style="color:var(--or);font-weight:600">Update in Settings</a></div>
    </div>

    <div id="pv-code-section" style="display:none;flex-direction:column;gap:12px">
      <div class="field">
        <label>6-digit code</label>
        <input type="text" id="pv-code-input" placeholder="123456" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" style="font-size:24px;letter-spacing:8px;text-align:center;font-family:Menlo,monospace">
      </div>
      <button class="btn" id="pv-verify-btn" onclick="pvVerifyCode()">Verify and continue</button>
      <button class="btn-o" id="pv-resend-btn" onclick="pvResendCode()" disabled style="opacity:.6">Resend code (60s)</button>
      <div id="pv-error" style="font-size:12px;color:var(--rd);text-align:center;display:none"></div>
    </div>
  </div>
</div>`;
    let r = tryReplace(updated, vehicleStepClose, phoneVerifyStep);
    if (!r) errExit('activate.html: vehicle step close anchor not found');
    updated = r;

    // ── 7.2.b  Add JS module: pv* functions, flowAfterVehicle, activateEtag, URL token reading ──
    // Insert at end of <script> block, before the closing </script>.
    // The simplest reliable anchor is the very last </script> in the file.
    const lastScriptIdx = updated.lastIndexOf('</script>');
    if (lastScriptIdx === -1) errExit('activate.html: no </script> tag found');

    const newJs = `
// ===== ${MARKER_7} =====================================================
// SMS verification UI logic + flow routing.
//
// Per-activation SMS gate:
//  1. After vehicle details, route through phone-verify step
//  2. pvSendCode() -> POST /api/start-phone-verification
//  3. SMS arrives, user types code
//  4. pvVerifyCode() -> POST /api/confirm-phone-verification
//     -> server returns { success, activation_session_id }
//  5. session_id stored, control returns to flow handler:
//     - eTag flow: call activateEtag(session_id)
//     - Physical upgrade flow: call activatePhysicalSticker(session_id)
//     - Paid flow: store session_id, proceed to payment step
//
// ────────────────────────────────────────────────────────────────────

let pvActivationSessionId = null;
let pvAfterVerifyCallback = null;
let pvResendTimerId = null;

function maskPhone(p) {
  if (!p) return 'your phone';
  const digits = String(p).replace(/\\D/g, '');
  if (digits.length < 4) return 'your phone';
  return '***-***-' + digits.slice(-4);
}

function pvShow(callback) {
  pvAfterVerifyCallback = callback;
  // Reset UI
  document.getElementById('pv-send-section').style.display = 'flex';
  document.getElementById('pv-code-section').style.display = 'none';
  document.getElementById('pv-code-input').value = '';
  document.getElementById('pv-error').style.display = 'none';
  document.getElementById('pv-send-btn').disabled = false;
  document.getElementById('pv-send-btn').textContent = 'Send code via SMS';
  // Show the user's phone (masked)
  fetch('/api/get-dashboard?user_id=' + s.token).then(r => r.json()).then(d => {
    if (d.user && d.user.phone) {
      document.getElementById('pv-masked-phone').textContent = maskPhone(d.user.phone);
    }
  }).catch(() => {});
  showStep('phone-verify');
}

async function pvSendCode() {
  const btn = document.getElementById('pv-send-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const res = await fetch('/api/start-phone-verification', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ user_id: s.token })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      btn.disabled = false;
      btn.textContent = 'Send code via SMS';
      showToast(data.error || 'Could not send code. Please try again.');
      return;
    }
    // Move to code-entry section
    document.getElementById('pv-send-section').style.display = 'none';
    document.getElementById('pv-code-section').style.display = 'flex';
    document.getElementById('pv-code-input').focus();
    pvStartResendCooldown();
  } catch(e) {
    btn.disabled = false;
    btn.textContent = 'Send code via SMS';
    showToast('Network error');
  }
}

function pvStartResendCooldown() {
  const btn = document.getElementById('pv-resend-btn');
  let secs = 60;
  btn.disabled = true;
  btn.style.opacity = '.6';
  btn.textContent = 'Resend code (' + secs + 's)';
  if (pvResendTimerId) clearInterval(pvResendTimerId);
  pvResendTimerId = setInterval(() => {
    secs--;
    if (secs <= 0) {
      clearInterval(pvResendTimerId);
      pvResendTimerId = null;
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.textContent = 'Resend code';
    } else {
      btn.textContent = 'Resend code (' + secs + 's)';
    }
  }, 1000);
}

async function pvResendCode() {
  const btn = document.getElementById('pv-resend-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const res = await fetch('/api/start-phone-verification', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ user_id: s.token })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      btn.disabled = false;
      btn.textContent = 'Resend code';
      showToast(data.error || 'Could not resend');
      return;
    }
    pvStartResendCooldown();
    showToast('Code resent');
  } catch(e) {
    btn.disabled = false;
    btn.textContent = 'Resend code';
    showToast('Network error');
  }
}

async function pvVerifyCode() {
  const code = document.getElementById('pv-code-input').value.trim();
  const errEl = document.getElementById('pv-error');
  errEl.style.display = 'none';
  if (!/^\\d{6}$/.test(code)) {
    errEl.textContent = 'Please enter the 6-digit code';
    errEl.style.display = 'block';
    return;
  }
  const btn = document.getElementById('pv-verify-btn');
  btn.disabled = true;
  btn.textContent = 'Verifying...';
  try {
    const res = await fetch('/api/confirm-phone-verification', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ user_id: s.token, code })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      btn.disabled = false;
      btn.textContent = 'Verify and continue';
      errEl.textContent = data.error || 'Wrong or expired code. Please try again.';
      errEl.style.display = 'block';
      return;
    }
    if (!data.activation_session_id) {
      btn.disabled = false;
      btn.textContent = 'Verify and continue';
      errEl.textContent = 'Verification succeeded but session creation failed. Please try again.';
      errEl.style.display = 'block';
      return;
    }
    pvActivationSessionId = data.activation_session_id;
    btn.textContent = 'Continuing...';
    if (pvAfterVerifyCallback) pvAfterVerifyCallback(pvActivationSessionId);
  } catch(e) {
    btn.disabled = false;
    btn.textContent = 'Verify and continue';
    errEl.textContent = 'Network error. Please try again.';
    errEl.style.display = 'block';
  }
}

// ===== ${MARKER_7} flow routing =========================================
// Decides which activation path to take based on what kind of tag is being
// activated. Called from proceedToPayment() and proceedFromCarChoice().

function flowAfterVehicle() {
  // Determine what kind of activation this is.
  // - scannedTag.owner_id === s.token AND status === 'claimed' AND token starts with TMC-ET
  //   -> own claimed eTag, free activation
  // - isPhysicalUpgrade === true AND user is on paid plan -> free physical upgrade
  // - else -> paid new physical (Stripe checkout)
  //
  // In all cases: SMS verify first, then route to activation.

  const isOwnEtag = scannedTag &&
    scannedTag.owner_id === s.token &&
    (scannedTag.status === 'claimed' || scannedTag.status === 'unclaimed') &&
    (scannedTag.token || '').toUpperCase().indexOf('TMC-ET') === 0;

  if (isOwnEtag) {
    // Free eTag activation: SMS verify, then activateEtag with session_id
    pvShow((sessionId) => activateEtag(sessionId));
    return;
  }

  if (isPhysicalUpgrade) {
    // Free physical upgrade for paid user: SMS verify, then activatePhysicalSticker
    pvShow((sessionId) => activatePhysicalSticker(sessionId));
    return;
  }

  // Paid new physical: SMS verify first, then go to payment step.
  // The session_id is stored in pvActivationSessionId and consumed by
  // create-checkout (via Stripe metadata) and the webhook.
  pvShow((sessionId) => {
    // Store in localStorage as backup so it survives the Stripe round-trip
    try { localStorage.setItem('tmc_pending_activation_session', sessionId); } catch(e) {}
    showStep('payment');
  });
}

// ===== ${MARKER_7} activateEtag =========================================
// Free eTag activation. Parallel to activatePhysicalSticker but no payment,
// no eTag deactivation, just claim + activate the user's own eTag.

async function activateEtag(activationSessionId) {
  try {
    const res = await fetch('/api/get-tag', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        token: scannedToken,
        user_id: s.token,
        activation_session_id: activationSessionId,
        license_plate: vehicleData.license_plate,
        car_make: vehicleData.car_make,
        car_model: vehicleData.car_model,
        car_year: vehicleData.car_year,
        car_color: vehicleData.car_color
      })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.error || 'Activation failed. Please try again.');
      // Stay on phone-verify step so user can retry (with new SMS)
      showStep('vehicle');
      return;
    }
    document.getElementById('success-title').textContent = 'eTag Activated!';
    document.getElementById('success-message').textContent = 'Your eTag is now active. Print or download it from the Free eTag page to use on your vehicle.';
    showStep('success');
  } catch(e) {
    showToast('Network error. Please try again.');
    showStep('vehicle');
  }
}

// ===== ${MARKER_7} URL ?token= reading =================================
// If activate.html is loaded with ?token=TMC-XXXXX in the URL, auto-process
// that token as if it had been scanned. Lets etag.html link directly to
// activate.html without forcing the user through the QR scanner.
(function tmcReadUrlToken() {
  try {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    if (!t) return;
    const cleaned = t.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!cleaned) return;
    // Wait briefly so the page is initialized, then process
    setTimeout(() => {
      try { stopScanner(); } catch(e) {}
      processToken(cleaned);
    }, 300);
  } catch(e) { /* noop */ }
})();
`;

    updated = updated.slice(0, lastScriptIdx) + newJs + updated.slice(lastScriptIdx);

    // ── 7.2.c  Patch activatePhysicalSticker to accept and pass session_id ──
    const apsOldSig = 'async function activatePhysicalSticker() {';
    const apsNewSig = 'async function activatePhysicalSticker(activationSessionId) {';
    r = tryReplace(updated, apsOldSig, apsNewSig);
    if (!r) errExit('activate.html: activatePhysicalSticker signature not found');
    updated = r;

    // Inside activatePhysicalSticker, the activation fetch needs activation_session_id.
    // The block to replace is the second fetch (the new tag activation). Match
    // the exact body of that fetch.
    const apsOldBody = `body: JSON.stringify({
        token: scannedToken,
        user_id: s.token,
        license_plate: vehicleData.license_plate,
        car_make: vehicleData.car_make,
        car_model: vehicleData.car_model,
        car_year: vehicleData.car_year,
        car_color: vehicleData.car_color
      })
    });
  } catch(e) { console.error('Failed to activate new tag:', e); }`;

    const apsNewBody = `body: JSON.stringify({
        token: scannedToken,
        user_id: s.token,
        activation_session_id: activationSessionId,
        license_plate: vehicleData.license_plate,
        car_make: vehicleData.car_make,
        car_model: vehicleData.car_model,
        car_year: vehicleData.car_year,
        car_color: vehicleData.car_color
      })
    });
  } catch(e) { console.error('Failed to activate new tag:', e); }`;
    r = tryReplace(updated, apsOldBody, apsNewBody);
    if (!r) {
      warn('activate.html: activatePhysicalSticker activation body not found, may need manual review');
    } else {
      updated = r;
    }

    // ── 7.2.d  Patch processPayment to require SMS verify and pass session_id ──
    // The existing flow calls processPayment immediately on the payment step's
    // Continue button. We need processPayment to send activation_session_id
    // to /api/create-checkout. The session_id is already in pvActivationSessionId
    // (set by flowAfterVehicle's pvShow callback before reaching this step).
    const ppOldBody = `const res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        user_id: s.token,
        flow: 'activate',
        plan: selectedPlan,
        prepay: prepayEnabled,
        referral_discount: 0
      })
    });`;
    const ppNewBody = `const res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        user_id: s.token,
        flow: 'activate',
        plan: selectedPlan,
        prepay: prepayEnabled,
        referral_discount: 0,
        activation_session_id: pvActivationSessionId || (function(){ try { return localStorage.getItem('tmc_pending_activation_session'); } catch(e) { return null; } })(),
        token: scannedToken
      })
    });`;
    r = tryReplace(updated, ppOldBody, ppNewBody);
    if (!r) {
      warn('activate.html: processPayment create-checkout call not found, manual review needed');
    } else {
      updated = r;
    }

    // ── 7.2.e  Update proceedToPayment and proceedFromCarChoice to route via flowAfterVehicle ──
    const ptpOld = `function proceedToPayment() {
  const plate = document.getElementById('v-plate').value.trim();
  if (!plate) { showToast('License plate is required'); return; }

  vehicleData = {
    license_plate: plate.toUpperCase(),
    car_make: document.getElementById('v-make').value.trim(),
    car_model: document.getElementById('v-model').value.trim(),
    car_year: document.getElementById('v-year').value.trim(),
    car_color: document.getElementById('v-color').value.trim()
  };

  if (isPhysicalUpgrade) {
    activatePhysicalSticker();
  } else {
    showStep('payment');
  }
}`;
    const ptpNew = `function proceedToPayment() {
  const plate = document.getElementById('v-plate').value.trim();
  if (!plate) { showToast('License plate is required'); return; }

  vehicleData = {
    license_plate: plate.toUpperCase(),
    car_make: document.getElementById('v-make').value.trim(),
    car_model: document.getElementById('v-model').value.trim(),
    car_year: document.getElementById('v-year').value.trim(),
    car_color: document.getElementById('v-color').value.trim()
  };

  // ${MARKER_7}: route through phone-verify step (every activation needs fresh SMS)
  flowAfterVehicle();
}`;
    r = tryReplace(updated, ptpOld, ptpNew);
    if (!r) errExit('activate.html: proceedToPayment block not found');
    updated = r;

    // proceedFromCarChoice — when user picks 'same' car, also route through phone-verify.
    const pfcOld = `function proceedFromCarChoice() {
  if (carChoice === 'same') {
    // Copy existing vehicle details
    vehicleData = {
      license_plate: existingTag.license_plate,
      car_make: existingTag.car_make,
      car_model: existingTag.car_model,
      car_year: existingTag.car_year,
      car_color: existingTag.car_color
    };

    // Check if this is a paid upgrade (no payment needed)
    if (isPhysicalUpgrade) {
      activatePhysicalSticker();
    } else {
      showStep('payment');
    }
  } else {
    showStep('vehicle');
  }
}`;
    const pfcNew = `function proceedFromCarChoice() {
  if (carChoice === 'same') {
    // Copy existing vehicle details
    vehicleData = {
      license_plate: existingTag.license_plate,
      car_make: existingTag.car_make,
      car_model: existingTag.car_model,
      car_year: existingTag.car_year,
      car_color: existingTag.car_color
    };

    // ${MARKER_7}: route through phone-verify step
    flowAfterVehicle();
  } else {
    showStep('vehicle');
  }
}`;
    r = tryReplace(updated, pfcOld, pfcNew);
    if (!r) errExit('activate.html: proceedFromCarChoice block not found');
    updated = r;

    writeFile(file, updated);
    ok('activate.html: SMS verify step added, flow routing updated, eTag activation fixed');
  }
}

// ===========================================================================
// 7.3  create-checkout.js: pass activation_session_id and token in metadata
// ===========================================================================

log('');
log('7.3  create-checkout.js: forward activation_session_id to Stripe metadata');

{
  const file = path.join(API, 'create-checkout.js');
  const content = readFile(file);

  if (content.includes(MARKER_7)) {
    skip('create-checkout.js (already updated)');
  } else {
    backup(file);
    let updated = content;

    // Find the metadata object inside session create — line 179 area.
    // Add activation_session_id and token fields if not already there.
    // The destructuring at top of handler likely needs updating too.

    // First: add activation_session_id to req.body destructuring.
    // Find the actual `const { user_id, flow, plan, ... } = req.body;` and inject our fields.
    const destrOld = 'const { user_id, flow, plan, prepay, referral_discount } = req.body;';
    if (updated.includes(destrOld)) {
      updated = updated.replace(
        destrOld,
        '// ' + MARKER_7 + ': accept activation_session_id + token from body\n  const { activation_session_id: _tmcActSession, token: _tmcTagToken } = req.body;\n  ' + destrOld
      );
    } else {
      warn('create-checkout.js: destructuring anchor not found');
    }

    // Now find the metadata object and inject our two fields.
    // Pattern: looking for `metadata: {` block in session create.
    const metaOld = `metadata: {
        user_id,
        plan,
        flow,`;
    const metaNew = `metadata: {
        user_id,
        plan,
        flow,
        // ${MARKER_7}: pass through to webhook for activation gate
        activation_session_id: _tmcActSession || '',
        tag_token: _tmcTagToken || '',`;
    const r = tryReplace(updated, metaOld, metaNew);
    if (r) {
      updated = r;
      writeFile(file, updated);
      validateJs(file);
      ok('create-checkout.js: activation_session_id + tag_token added to metadata');
    } else {
      warn('create-checkout.js: metadata anchor not found, no changes written');
    }
  }
}

// ===========================================================================
// 7.4  stripe-webhook.js: validate + consume session before activating tag
// ===========================================================================

log('');
log('7.4  stripe-webhook.js: validate activation_session_id before tag flip');

{
  const file = path.join(API, 'stripe-webhook.js');
  const content = readFile(file);

  if (content.includes(MARKER_7)) {
    skip('stripe-webhook.js (already gated)');
  } else {
    backup(file);
    let updated = content;

    // Modify the destructuring of session.metadata to also pull our fields.
    const destrOld = `const { user_id, plan, flow, prepay, sticker_count, subscription_price_id } = session.metadata || {};`;
    const destrNew = `const { user_id, plan, flow, prepay, sticker_count, subscription_price_id, activation_session_id, tag_token } = session.metadata || {};`;
    let r = tryReplace(updated, destrOld, destrNew);
    if (!r) errExit('stripe-webhook.js: metadata destructuring not found');
    updated = r;

    // Insert validation block right BEFORE the "ACTIVATE TAG" block.
    // The exact box-drawing chars vary, so match on the substantive content
    // ("ACTIVATE TAG" comment + the supabase update right after).
    const activateRe = /(\n\s*\/\/ [\u2500\u2014]+ ACTIVATE TAG [\u2500\u2014]+\s*\n\s*await supabase\.from\("tags"\)\.update\(\{\s*\n\s*status: "active",\s*\n\s*activated_at: new Date\(\)\.toISOString\(\),\s*\n\s*plan: userPlanNow\s*\n\s*\}\)\.eq\("owner_id", user_id\);)/;
    const activateMatch = updated.match(activateRe);
    if (!activateMatch) {
      warn('stripe-webhook.js: ACTIVATE TAG regex anchor not found. Dump first lines for inspection.');
      errExit('stripe-webhook.js: anchor failed, manual review needed');
    }
    const activateOriginal = activateMatch[0];

    const gateBlock = `\n        // ${MARKER_7}: validate and consume the activation_session_id from
        // pre-checkout SMS verification. If invalid, log a critical error
        // and DO NOT activate the tag. Customer paid but tag stays unclaimed.
        // (Refund handling is a future concern; for now: alert via console
        // and let the customer contact support.)
        if (activation_session_id) {
          try {
            const { data: actSession } = await supabase
              .from('activation_sessions')
              .select('id, user_id, created_at, used')
              .eq('id', activation_session_id)
              .maybeSingle();

            const ageMs = actSession ? Date.now() - new Date(actSession.created_at).getTime() : Infinity;
            const valid = actSession &&
              actSession.user_id === user_id &&
              !actSession.used &&
              ageMs <= 15 * 60 * 1000;

            if (!valid) {
              console.error('PATCH7 CRITICAL: activation_session_id invalid for paid checkout', {
                session_id: activation_session_id,
                user_id,
                tag_token,
                reason: !actSession ? 'not found' : actSession.user_id !== user_id ? 'user mismatch' : actSession.used ? 'already used' : 'expired'
              });
              break;
            }

            await supabase
              .from('activation_sessions')
              .update({ used: true, used_at: new Date().toISOString() })
              .eq('id', activation_session_id)
              .eq('used', false);
          } catch (sessionErr) {
            console.error('PATCH7 CRITICAL: activation_session validation threw', sessionErr.message);
            break;
          }
        } else {
          console.error('PATCH7 CRITICAL: no activation_session_id in checkout metadata', {
            user_id,
            tag_token,
            session_id: session.id
          });
          break;
        }`;

    updated = updated.replace(activateOriginal, gateBlock + activateOriginal);

    writeFile(file, updated);
    validateJs(file);
    ok('stripe-webhook.js: activation_session_id validated + consumed before tag flip');
  }
}

// ===========================================================================
// Done
// ===========================================================================

log('');
log('==============================================================');
log('Patch 7 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Patches 5, 6, 7 are now all applied locally. Time to push:');
log('');
log('  git add -A');
log('  git commit -m "Patches 5-7: per-activation SMS verification end-to-end"');
log('  git push');
log('');
log('Wait ~60 seconds for Vercel deploy.');
log('');
log('Test paths in fresh incognito (priorities ordered):');
log('');
log('  1. eTag activation (was previously broken):');
log('     - Sign in, go to /etag.html, click "Activate to enable masked calls"');
log('     - You land on /activate.html?token=TMC-ETxxxxx');
log('     - Token auto-processes, you see "Your tag — ready to activate"');
log('     - Fill vehicle details, Continue');
log('     - Phone verify step appears, click Send code');
log('     - SMS arrives, type code, click Verify and continue');
log('     - eTag activates, success screen shows');
log('');
log('  2. Wrong code path:');
log('     - Same flow as above');
log('     - Type wrong 6-digit code');
log('     - Should see "Wrong or expired code" — stays on step');
log('     - Wait for resend cooldown, click Resend, get new SMS');
log('     - Type correct code, succeeds');
log('');
log('  3. Existing physical sticker activation (smoke test):');
log('     - Should still work — same flow with phone-verify added');
log('');
log('  4. Paid checkout flow:');
log('     - From pricing.html, buy a Standard plan');
log('     - SMS verify happens before Stripe redirect');
log('     - Complete Stripe checkout');
log('     - Webhook activates tag using session_id from metadata');
log('     - Verify tag is active in Supabase');
log('');
log('==============================================================');
