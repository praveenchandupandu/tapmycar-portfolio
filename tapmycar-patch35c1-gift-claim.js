// ============================================================================
// TapMyCar - Patch 35c-1: Gift tag recipient claim flow
//
// Admin can already mark a tag as a gift (Patch 35b). This patch makes the
// gift actually DO something when the recipient scans and claims it.
//
// PART A - Backend (api/get-tag.js):
//   After a tag is claimed, if the tag has is_gift=true, ALSO:
//     - set the tag's plan column to gift_plan
//     - update the OWNER (users row): plan = gift_plan,
//       gift_plan_starts_at = NOW(),
//       gift_plan_expires_at = NOW() + gift_months months
//   Done server-side so it is atomic and cannot be skipped or faked.
//
// PART B - Frontend (public/activate.html):
//   - When a gift tag is scanned, the result screen shows a gift welcome
//     banner: "You received a free TapMyCar sticker! Free N-month trial
//     of <Plan> plan included."
//   - flowAfterVehicle() gets a 4th branch: gift tag -> SMS verify ->
//     claim with NO payment (reuses the get-tag claim, payment skipped).
//   - The success screen shows a gift-specific message.
//
// Phone verification is STILL required for gift recipients (only payment
// is skipped) - a tag with an unverified phone cannot receive calls.
//
// What this patch does NOT do (that is Patch 35c-2):
//   - Day-25 dashboard expiry banner
//   - Daily expiry cron (downgrade expired trials)
//   - Reminder emails (5d / 1d / day-of)
//
// Properties: idempotent, safeReplace, per-file backup, JS validation.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35c1-${ts}`);

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
log('TapMyCar Patch 35c-1 \u2014 gift tag recipient claim flow');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35C1_GIFT_CLAIM';

// =============================================================================
// PART A - api/get-tag.js: apply the trial when a gift tag is claimed
// =============================================================================

log('Part A  api/get-tag.js: apply trial on gift-tag claim');
{
  const file = path.join(API, 'get-tag.js');
  const content = readFile(file);

  if (content.includes(MARKER)) {
    skip('get-tag.js');
  } else {
    backup(file);

    /* Anchor: the claim update + its result, ending with the success return.
       We insert gift-trial logic right before the existing success return. */
    const oldReturn = `    const { data, error } = await supabase
      .from('tags')
      .update(updates)
      .eq('token', cleanToken)
      .select()
      .single();

    if (error) {
      console.error('Update tag error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true, tag: data ? data[0] : null });`;

    const newReturn = `    const { data, error } = await supabase
      .from('tags')
      .update(updates)
      .eq('token', cleanToken)
      .select()
      .single();

    if (error) {
      console.error('Update tag error:', error);
      return res.status(500).json({ error: error.message });
    }

    /* ${MARKER}: if the claimed tag is a gift, apply the trial plan to the
       tag and to the owner. The tag row we just updated (data) carries the
       gift_* columns, so we read them straight off it. */
    let giftApplied = null;
    try {
      if (data && data.is_gift === true) {
        const giftPlan = data.gift_plan || 'standard';
        const giftMonths = Number(data.gift_months) > 0 ? Number(data.gift_months) : 1;

        const nowMs = Date.now();
        const startsAt = new Date(nowMs).toISOString();
        /* add giftMonths calendar months */
        const expiryDate = new Date(nowMs);
        expiryDate.setMonth(expiryDate.getMonth() + giftMonths);
        const expiresAt = expiryDate.toISOString();

        /* 1) set the tag's plan to the gift plan */
        await supabase
          .from('tags')
          .update({ plan: giftPlan })
          .eq('token', cleanToken);

        /* 2) set the owner's plan + trial window */
        await supabase
          .from('users')
          .update({
            plan: giftPlan,
            gift_plan_starts_at: startsAt,
            gift_plan_expires_at: expiresAt
          })
          .eq('id', user_id);

        giftApplied = { plan: giftPlan, months: giftMonths, expires_at: expiresAt };
      }
    } catch (giftErr) {
      /* Non-fatal: the tag is claimed; trial application failed. Log it so
         it can be fixed manually. The claim itself still succeeded. */
      console.error('${MARKER}: gift trial application failed:', giftErr && giftErr.message);
    }

    return res.json({ success: true, tag: data ? data[0] : null, gift: giftApplied });`;

    const r = safeReplace(content, oldReturn, newReturn);
    if (!r) errExit('get-tag.js: claim-return anchor not found');
    writeFile(file, r);

    try {
      execSync('node --check "' + file + '"', { stdio: 'pipe' });
      ok('get-tag.js: gift-trial logic added, JS valid');
    } catch (e) {
      errExit('get-tag.js JS error: ' + e.stderr.toString());
    }
  }
}

// =============================================================================
// PART B - public/activate.html: gift banner + gift claim branch
// =============================================================================

log('');
log('Part B  public/activate.html: gift banner + claim branch');
{
  const file = path.join(PUBLIC, 'activate.html');
  const content = readFile(file);

  if (content.includes(MARKER)) {
    skip('activate.html');
  } else {
    backup(file);
    let updated = content;

    /* B1: in the unclaimed-tag result branch, detect gift tags and show a
       banner. We hook the "Completely unclaimed, no existing tag" block. */
    const oldUnclaimed = `    // Completely unclaimed, no existing tag — new activation
    document.getElementById('r-status').textContent = 'Ready to activate';
    document.getElementById('r-status').className = 'result-status result-new';
    document.getElementById('r-message').textContent = 'This tag is available. Activate it now!';
    isPhysicalUpgrade = false;
    document.getElementById('r-action').innerHTML = '<button class="btn" style="margin-top:14px" onclick="proceedFromResult()">Activate this tag →</button>';`;

    const newUnclaimed = `    // Completely unclaimed, no existing tag — new activation
    isPhysicalUpgrade = false;
    /* ${MARKER}: gift tag detection */
    if (scannedTag && scannedTag.is_gift === true) {
      const gMonths = Number(scannedTag.gift_months) > 0 ? Number(scannedTag.gift_months) : 1;
      const gPlanRaw = scannedTag.gift_plan || 'standard';
      const gPlan = gPlanRaw.charAt(0).toUpperCase() + gPlanRaw.slice(1);
      document.getElementById('r-status').textContent = 'Gift tag';
      document.getElementById('r-status').className = 'result-status result-new';
      document.getElementById('r-message').innerHTML =
        '<div style="background:linear-gradient(135deg,#FFF3EC,#FFE4D4);border:1px solid #FFB98A;border-radius:14px;padding:16px;margin:6px 0">' +
        '<div style="font-size:26px;margin-bottom:6px">\\uD83C\\uDF81</div>' +
        '<div style="font-weight:800;font-size:15px;color:#C2410C;margin-bottom:4px">You received a free TapMyCar sticker!</div>' +
        '<div style="font-size:13px;color:#9A3412;line-height:1.5">Free ' + gMonths + '-month trial of the <strong>' + gPlan + '</strong> plan included. No payment needed \\u2014 just verify your phone and you are set.</div>' +
        '</div>';
      document.getElementById('r-action').innerHTML = '<button class="btn" style="margin-top:14px" onclick="proceedFromResult()">Claim my free sticker \\u2192</button>';
      return;
    }
    document.getElementById('r-status').textContent = 'Ready to activate';
    document.getElementById('r-status').className = 'result-status result-new';
    document.getElementById('r-message').textContent = 'This tag is available. Activate it now!';
    document.getElementById('r-action').innerHTML = '<button class="btn" style="margin-top:14px" onclick="proceedFromResult()">Activate this tag →</button>';`;

    let r = safeReplace(updated, oldUnclaimed, newUnclaimed);
    if (!r) errExit('activate.html: unclaimed-result anchor not found');
    updated = r;
    ok('activate.html: gift banner on scan result');

    /* B2: flowAfterVehicle() — add a gift branch before the paid branch.
       Gift tags: SMS verify, then claim with no payment. */
    const oldPaidBranch = `  // Paid new physical: SMS verify first, then go to payment step.
  // The session_id is stored in pvActivationSessionId and consumed by
  // create-checkout (via Stripe metadata) and the webhook.
  pvShow((sessionId) => {`;

    const newPaidBranch = `  /* ${MARKER}: gift tag — SMS verify, then claim with NO payment */
  if (scannedTag && scannedTag.is_gift === true) {
    pvShow((sessionId) => activateGiftTag(sessionId));
    return;
  }

  // Paid new physical: SMS verify first, then go to payment step.
  // The session_id is stored in pvActivationSessionId and consumed by
  // create-checkout (via Stripe metadata) and the webhook.
  pvShow((sessionId) => {`;

    r = safeReplace(updated, oldPaidBranch, newPaidBranch);
    if (!r) errExit('activate.html: flowAfterVehicle paid-branch anchor not found');
    updated = r;
    ok('activate.html: gift branch added to flowAfterVehicle');

    /* B3: add the activateGiftTag() function. Insert right before
       activateEtag() which is a clean, similar sibling. */
    const oldEtagFn = `// ===== TMC_PATCH7_ACTIVATE_SMS activateEtag =========================================
// Free eTag activation. Parallel to activatePhysicalSticker but no payment,
// no eTag deactivation, just claim + activate the user's own eTag.

async function activateEtag(activationSessionId) {`;

    const newEtagFn = `// ${MARKER}: gift tag activation. Claims the tag with no payment. The
// backend (get-tag.js) detects is_gift and applies the trial plan + expiry
// to the user automatically.
async function activateGiftTag(activationSessionId) {
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
      showStep('vehicle');
      return;
    }
    let planName = 'your plan';
    let monthsTxt = '';
    if (data.gift) {
      planName = (data.gift.plan || 'standard');
      planName = planName.charAt(0).toUpperCase() + planName.slice(1);
      monthsTxt = (data.gift.months || 1) + '-month';
    }
    document.getElementById('success-title').textContent = 'Gift Activated! \\uD83C\\uDF81';
    document.getElementById('success-message').textContent =
      'Your free ' + monthsTxt + ' ' + planName + ' trial is active and your sticker is ready. Place it on your vehicle and you are all set.';
    showStep('success');
  } catch(e) {
    showToast('Network error. Please try again.');
    showStep('vehicle');
  }
}

// ===== TMC_PATCH7_ACTIVATE_SMS activateEtag =========================================
// Free eTag activation. Parallel to activatePhysicalSticker but no payment,
// no eTag deactivation, just claim + activate the user's own eTag.

async function activateEtag(activationSessionId) {`;

    r = safeReplace(updated, oldEtagFn, newEtagFn);
    if (!r) errExit('activate.html: activateEtag anchor not found');
    updated = r;
    ok('activate.html: activateGiftTag() function added');

    writeFile(file, updated);

    /* sanity: marker present 4x, no obvious breakage */
    const verify = readFile(file);
    const markerCount = (verify.match(/TMC_PATCH35C1_GIFT_CLAIM/g) || []).length;
    if (markerCount < 3) errExit('activate.html: marker count too low (' + markerCount + ')');
    ok('activate.html: verified (' + markerCount + ' markers)');
  }
}

log('');
log('==============================================================');
log('Patch 35c-1 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35c-1: gift tag recipient claim flow"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('Test (end to end):');
log('  1. As admin: Promos tab -> Gift Activate Tag. Pick a verified');
log('     unclaimed physical tag, plan = Standard, months = 1, no email.');
log('     Activate it as a gift.');
log('  2. Sign in as a DIFFERENT user (the would-be recipient).');
log('  3. Go to activate.html and scan/enter that gift token.');
log('  4. The result screen shows the orange gift banner:');
log('     "You received a free TapMyCar sticker! Free 1-month trial..."');
log('  5. Claim it -> enter vehicle details -> verify phone (OTP).');
log('     NO payment step appears.');
log('  6. Success screen: "Gift Activated!" with the trial details.');
log('  7. Verify in Supabase:');
log('     SELECT token, status, plan, is_gift FROM tags WHERE token=(TMC-XXX);');
log('       -> status=active, plan=standard');
log('     SELECT plan, gift_plan_starts_at, gift_plan_expires_at FROM users');
log('       WHERE id=(recipient user id);');
log('       -> plan=standard, expires ~1 month out');
log('');
log('Note: trial EXPIRY is not enforced yet. A claimed gift trial just');
log('sits active until Patch 35c-2 adds the expiry cron + reminders.');
log('==============================================================');
