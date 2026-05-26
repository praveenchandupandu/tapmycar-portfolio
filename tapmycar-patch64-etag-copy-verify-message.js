// ============================================================================
// TapMyCar - Patch 64: eTag lifecycle copy + tag-verification safety message
//
// CONFIRMED eTAG MODEL (verified against api/create-checkout.js)
//   - Start free with a digital eTag.
//   - Pay $1 to ACTIVATE and experience the full service for 30 days
//     (no physical sticker yet).
//   - Day 30: the physical sticker ships and the sticker price is charged
//     ($9.99 Standard / $24.99 Premium).
//   - Day 60: the annual plan begins ($9.99/yr Standard / $19.99/yr Premium)
//     and renews yearly until cancelled.
//   (terms.html section 3 already states this correctly - left as-is.)
//
// WHAT THIS PATCH DOES
//   1. pricing.html - the FREE eTAG card copy is rewritten from the outdated
//      "no payment, $1 later, zero charge" text to an honest, warm preview
//      of the real journey: free eTag -> $1 activation (30-day experience)
//      -> sticker -> annual plan, with a link to full pricing.
//   2. pricing.html - the Standard & Premium card disclosure lines currently
//      say "On day 30 we auto-charge ... to start your annual plan" - which
//      CONTRADICTS the code (day 30 = sticker shipment + sticker charge,
//      day 60 = annual plan). Both disclosures are corrected to match the
//      code, so the page and the actual billing tell ONE story.
//      NOTE: pricing.html has script that rewrites these spans for the
//      prepay toggle - that script's text is updated too (steps 2c/2d).
//   3. landing.html - the free-eTag card gets an honest one-line note about
//      the $1 / 30-day model instead of just "Download instantly".
//   4. verify.html, terms.html, privacy.html - a tag-verification SAFETY
//      message is added: always confirm a tag is genuine with the Verify
//      feature; if it doesn't verify, treat it with caution.
//
//   No SQL change. Syncs the 4 edited HTML files to root.
//
// Properties: idempotent (safe to re-run), backs up every file before edit.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch64-${ts}`);

const log  = (s) => console.log(s);
const ok   = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function backup(absPath, label) {
  if (!fs.existsSync(absPath)) return;
  const dest = path.join(BACKUP_DIR, label);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(absPath, dest);
}
function replaceOnce(src, find, replace, label) {
  const idx = src.indexOf(find);
  if (idx === -1) errExit(label + ': anchor not found - file differs from expected.');
  if (src.indexOf(find, idx + find.length) !== -1) {
    errExit(label + ': anchor matches more than once.');
  }
  return src.replace(find, function () { return replace; });
}

log('');
log('TapMyCar Patch 64 - eTag lifecycle copy + verification message');
log('==============================================================');

// ----------------------------------------------------------------------------
// STEP 1+2 - pricing.html
// ----------------------------------------------------------------------------
log('');
log('Step 1+2 - public/pricing.html');

const pricingPath = path.join(PUBLIC, 'pricing.html');
let pricing = fs.readFileSync(pricingPath, 'utf8');

if (pricing.indexOf('TMC_PATCH64') !== -1) {
  skip('public/pricing.html');
} else {
  backup(pricingPath, 'public/pricing.html');

  // 1 - rewrite the free eTag card body (tagline + bullets + disclosure).
  const ETAG_OLD =
    '    <div class="plan-tagline" style="color:#9CA3AF">Digital QR download. No payment needed. Activate later with $1 when you want it to work.</div>\n' +
    '    <div class="bullets">\n' +
    '      <div class="bullet mute"><div class="bullet-dot"></div>Printable QR code — put it on your car today</div>\n' +
    '      <div class="bullet mute"><div class="bullet-dot"></div>Zero commitment, zero charge</div>\n' +
    '      <div class="bullet mute"><div class="bullet-dot"></div>Activate anytime by scanning your own tag ($1)</div>\n' +
    '    </div>\n' +
    '    <button class="btn-g" onclick="checkout(\'etag_free\', null)">Get my free eTag</button>\n' +
    '    <div class="disclosure">Tag stays inactive (scans show "not activated") until you pay $1 to activate.</div>';
  const ETAG_NEW =
    '    <!-- TMC_PATCH64 -->\n' +
    '    <div class="plan-tagline" style="color:#9CA3AF">Get your digital QR code free. When you\u2019re ready to switch it on, just $1 lets you experience everything for 30 days \u2014 no sticker needed yet.</div>\n' +
    '    <div class="bullets">\n' +
    '      <div class="bullet mute"><div class="bullet-dot"></div>Printable QR code \u2014 free to download, put it on your car today</div>\n' +
    '      <div class="bullet mute"><div class="bullet-dot"></div>$1 activation lets you try the full service for 30 days</div>\n' +
    '      <div class="bullet mute"><div class="bullet-dot"></div>Pick Standard or Premium when you activate</div>\n' +
    '    </div>\n' +
    '    <button class="btn-g" onclick="checkout(\'etag_free\', null)">Get my free eTag</button>\n' +
    '    <div class="disclosure">Free to download. Your tag is inactive until you activate it for $1. ' +
    'Activation lets you experience TapMyCar for 30 days; on day 30 your chosen plan\u2019s sticker ships ' +
    'and is charged ($9.99 Standard / $24.99 Premium), and on day 60 your annual plan begins ' +
    '($9.99/yr Standard / $19.99/yr Premium), renewing yearly until you cancel. You can cancel anytime ' +
    'before a charge in Settings. Full details: <a href="/pricing.html" style="color:#FF6B00">tapmycar.io/pricing</a>.</div>';
  pricing = replaceOnce(pricing, ETAG_OLD, ETAG_NEW, 'Step 1 free-eTag card');
  ok('Step 1 - free-eTag card rewritten (honest 30-day journey)');

  // 2a - Standard card disclosure: day 30 = sticker, day 60 = annual.
  pricing = replaceOnce(pricing,
    '<span id="std-disclose">Your card is charged $9.99 today for the sticker. On day 30, we auto-charge $9.99 to start your annual plan. It renews yearly until you cancel.</span>',
    '<span id="std-disclose">Your card is charged $9.99 today for your Standard sticker, which ships in 2\u20133 business days. On day 30, your $9.99/year annual plan begins and renews yearly until you cancel. Cancel anytime in Settings.</span>',
    'Step 2a std-disclose');
  ok('Step 2a - Standard disclosure corrected to match the code');

  // 2b - Premium card disclosure.
  pricing = replaceOnce(pricing,
    '<span id="prem-disclose">Your card is charged $24.99 today for the sticker. On day 30, we auto-charge $19.99 to start your annual plan. It renews yearly until you cancel.</span>',
    '<span id="prem-disclose">Your card is charged $24.99 today for your 3 Premium stickers, which ship in 2\u20133 business days. On day 30, your $19.99/year annual plan begins and renews yearly until you cancel. Cancel anytime in Settings.</span>',
    'Step 2b prem-disclose');
  ok('Step 2b - Premium disclosure corrected to match the code');

  // 2c + 2d - the prepay-toggle script rewrites these spans; fix its text too
  // so the prepay AND non-prepay wording both match the code.
  // Standard script branch.
  pricing = replaceOnce(pricing,
    "  document.getElementById('std-disclose').textContent = prepayState.std\n" +
    "    ? 'Your card is charged $19.98 today ($9.99 sticker + $9.99 year 1). Then $9.99/year on the 365-day anniversary, renewing yearly until you cancel.'\n" +
    "    : 'Your card is charged $9.99 today for the sticker. On day 30, we auto-charge $9.99 to start your annual plan. It renews yearly until you cancel.';",
    "  /* TMC_PATCH64 */ document.getElementById('std-disclose').textContent = prepayState.std\n" +
    "    ? 'Your card is charged $19.98 today ($9.99 sticker + $9.99 year 1). Your sticker ships in 2-3 business days, and your next $9.99/year charge is on the 365-day anniversary, renewing yearly until you cancel.'\n" +
    "    : 'Your card is charged $9.99 today for your Standard sticker, which ships in 2-3 business days. On day 30, your $9.99/year annual plan begins and renews yearly until you cancel. Cancel anytime in Settings.';",
    'Step 2c std script text');
  // Premium script branch.
  pricing = replaceOnce(pricing,
    "  document.getElementById('prem-disclose').textContent = prepayState.prem\n" +
    "    ? 'Your card is charged $44.98 today ($24.99 sticker + $19.99 year 1). Then $19.99/year on the 365-day anniversary, renewing yearly until you cancel.'\n" +
    "    : 'Your card is charged $24.99 today for the sticker. On day 30, we auto-charge $19.99 to start your annual plan. It renews yearly until you cancel.';",
    "  /* TMC_PATCH64 */ document.getElementById('prem-disclose').textContent = prepayState.prem\n" +
    "    ? 'Your card is charged $44.98 today ($24.99 for 3 stickers + $19.99 year 1). Your stickers ship in 2-3 business days, and your next $19.99/year charge is on the 365-day anniversary, renewing yearly until you cancel.'\n" +
    "    : 'Your card is charged $24.99 today for your 3 Premium stickers, which ship in 2-3 business days. On day 30, your $19.99/year annual plan begins and renews yearly until you cancel. Cancel anytime in Settings.';",
    'Step 2d prem script text');
  ok('Step 2c/2d - prepay script disclosure text corrected too');

  fs.writeFileSync(pricingPath, pricing, { encoding: 'utf8' });
  ok('public/pricing.html written');
}

// ----------------------------------------------------------------------------
// STEP 3 - landing.html free-eTag card note
// ----------------------------------------------------------------------------
log('');
log('Step 3 - public/landing.html (free-eTag card note)');

const landingPath = path.join(PUBLIC, 'landing.html');
let landing = fs.readFileSync(landingPath, 'utf8');

if (landing.indexOf('TMC_PATCH64') !== -1) {
  skip('public/landing.html');
} else {
  backup(landingPath, 'public/landing.html');
  const LAND_OLD =
    '<div style="font-size:12px;color:#15803D;margin-bottom:14px">Download instantly \u00b7 Get started in 2 minutes</div>';
  const LAND_NEW =
    '<!-- TMC_PATCH64 -->\n' +
    '    <div style="font-size:12px;color:#15803D;margin-bottom:6px">Download instantly \u00b7 Get started in 2 minutes</div>\n' +
    '    <div style="font-size:11px;color:#6B7280;margin-bottom:14px;line-height:1.5">Free to download. Activate for $1 to experience TapMyCar for 30 days; your chosen plan continues after \u2014 see <a href="/pricing.html" style="color:#FF6B00">pricing</a>.</div>';
  landing = replaceOnce(landing, LAND_OLD, LAND_NEW, 'Step 3 landing eTag note');
  fs.writeFileSync(landingPath, landing, { encoding: 'utf8' });
  ok('public/landing.html written');
}

// ----------------------------------------------------------------------------
// STEP 4 - verification safety message: verify.html, terms.html, privacy.html
// ----------------------------------------------------------------------------
log('');
log('Step 4 - verification safety message');

const VERIFY_MSG_TEXT =
  'Always confirm a tag is genuine using the Verify feature \u2014 it checks that the tag is a ' +
  'registered TapMyCar tag. If a tag does not verify, treat it with caution and do not rely on it.';

// 4a - verify.html : a visible note card.
const verifyPath = path.join(PUBLIC, 'verify.html');
let verify = fs.readFileSync(verifyPath, 'utf8');
if (verify.indexOf('TMC_PATCH64') !== -1) {
  skip('public/verify.html');
} else {
  backup(verifyPath, 'public/verify.html');
  const NAV_ANCHOR = '<nav class="tmc-fnav" aria-label="Main navigation">';
  const NOTE =
    '<!-- TMC_PATCH64 -->\n' +
    '<div style="max-width:520px;margin:0 auto 16px;padding:13px 15px;background:#FFF7ED;' +
    'border:1px solid #FED7AA;border-radius:12px;font-size:12.5px;line-height:1.6;color:#9A3412">' +
    '<b>Staying safe:</b> ' + VERIFY_MSG_TEXT + '</div>\n' +
    NAV_ANCHOR;
  verify = replaceOnce(verify, NAV_ANCHOR, NOTE, 'Step 4a verify.html note');
  fs.writeFileSync(verifyPath, verify, { encoding: 'utf8' });
  ok('Step 4a - verify.html safety note added');
}

// 4b - terms.html : an authenticity clause as a new section before Acceptable use.
const termsPath = path.join(PUBLIC, 'terms.html');
let terms = fs.readFileSync(termsPath, 'utf8');
if (terms.indexOf('TMC_PATCH64') !== -1) {
  skip('public/terms.html');
} else {
  backup(termsPath, 'public/terms.html');
  const AUP_ANCHOR = '  <h2>5. Acceptable use</h2>';
  const CLAUSE =
    '  <!-- TMC_PATCH64 -->\n' +
    '  <h2>Tag authenticity and verification</h2>\n' +
    '  <p>' + VERIFY_MSG_TEXT + ' The Verify feature confirms only that a tag is a registered ' +
    'TapMyCar tag; it is not a guarantee of any person\u2019s identity or intentions. Use normal ' +
    'caution when contacting or meeting anyone.</p>\n\n' +
    AUP_ANCHOR;
  terms = replaceOnce(terms, AUP_ANCHOR, CLAUSE, 'Step 4b terms.html clause');
  fs.writeFileSync(termsPath, terms, { encoding: 'utf8' });
  ok('Step 4b - terms.html authenticity clause added');
}

// 4c - privacy.html : a short note before "What we never do".
const privacyPath = path.join(PUBLIC, 'privacy.html');
let privacy = fs.readFileSync(privacyPath, 'utf8');
if (privacy.indexOf('TMC_PATCH64') !== -1) {
  skip('public/privacy.html');
} else {
  backup(privacyPath, 'public/privacy.html');
  const NEVER_ANCHOR = '  <h2>3. What we never do</h2>';
  const PNOTE =
    '  <!-- TMC_PATCH64 -->\n' +
    '  <h2>Verifying tags</h2>\n' +
    '  <p>' + VERIFY_MSG_TEXT + '</p>\n\n' +
    NEVER_ANCHOR;
  privacy = replaceOnce(privacy, NEVER_ANCHOR, PNOTE, 'Step 4c privacy.html note');
  fs.writeFileSync(privacyPath, privacy, { encoding: 'utf8' });
  ok('Step 4c - privacy.html verification note added');
}

// ----------------------------------------------------------------------------
// Sync to root
// ----------------------------------------------------------------------------
log('');
log('Sync to root');
['pricing.html', 'landing.html', 'verify.html', 'terms.html', 'privacy.html']
  .forEach(function (name) {
    const pub = path.join(PUBLIC, name);
    const rootCopy = path.join(ROOT, name);
    if (fs.existsSync(rootCopy)) {
      backup(rootCopy, 'root-' + name);
      fs.copyFileSync(pub, rootCopy);
      ok('Synced ' + name + ' -> root');
    }
  });

log('');
log('==============================================================');
log('Patch 64 applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s, hard-refresh. CHECK:');
log('   - /pricing.html free-eTag card: honest $1 / 30-day / sticker / annual.');
log('   - Standard & Premium cards: disclosure says day-30 sticker ships +');
log('     charge, day-30 annual plan begins (matches your checkout code).');
log('     Toggle the prepay box - the rewritten text is correct too.');
log('   - /landing.html eTag card: shows the $1 / 30-day note.');
log('   - /verify.html: orange safety note above the bottom nav.');
log('   - /terms.html and /privacy.html: the verification section.');
log('');
