// ============================================================================
// TapMyCar - Patch 66: Terms & Privacy corrections
//
// PROBLEMS FOUND in terms.html / privacy.html
//   A. Terms section 3 (Pricing and billing) contradicts itself and the
//      actual checkout code: the "Activation" line says the plan "begins
//      automatically after 30 days", but the Standard line says the annual
//      charge is at "day 60 after $1 activation". It also never states the
//      day-30 physical-sticker charge at all.
//   B. Terms section 2 sets the minimum age at 13. TapMyCar is a paid
//      product that takes card payments and creates subscriptions; a minor
//      cannot enter a binding payment contract. Minimum age -> 18.
//   C. Privacy section 7 ("Children") also references under-13. Updated to
//      reflect the 18+ minimum (while still noting under-13 / COPPA).
//
// WHAT THIS PATCH DOES
//   1. terms.html section 2 - minimum age 13 -> 18.
//   2. terms.html section 3 - the Activation, Standard and Premium lines are
//      rewritten to state the TRUE billing model, matching create-checkout.js:
//        $1 activates the tag for a 30-day trial and you choose your plan;
//        on day 30 the physical sticker ships and the sticker price is
//        charged; on day 60 the annual plan begins and renews yearly.
//   3. terms.html - the "Last updated" date is refreshed (the Terms changed).
//   4. privacy.html section 7 - updated to an 18+ service while keeping the
//      under-13 / COPPA statement.
//
//   No SQL change. Syncs terms.html + privacy.html to root.
//
// Properties: idempotent (safe to re-run), backs up both files before edit.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch66-${ts}`);

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
log('TapMyCar Patch 66 - Terms & Privacy corrections');
log('===============================================');

// ----------------------------------------------------------------------------
// STEP 1 - terms.html
// ----------------------------------------------------------------------------
log('');
log('Step 1 - public/terms.html');

const termsPath = path.join(PUBLIC, 'terms.html');
let terms = fs.readFileSync(termsPath, 'utf8');

if (terms.indexOf('TMC_PATCH66') !== -1) {
  skip('public/terms.html');
} else {
  backup(termsPath, 'public/terms.html');

  // 1a - minimum age 13 -> 18 in section 2.
  terms = replaceOnce(terms,
    'To use TapMyCar, you must be 13 or older and provide accurate information.',
    '<!-- TMC_PATCH66 -->To use TapMyCar, you must be 18 or older and able to enter ' +
    'a binding contract, and you must provide accurate information.',
    'Step 1a age 18');
  ok('Step 1a - minimum age set to 18');

  // 1b - rewrite the Activation line.
  terms = replaceOnce(terms,
    '<li><b>Activation:</b> $1 one-time fee. Enables masked calling for 30 days. After 30 days, your chosen plan (Standard or Premium) begins automatically.</li>',
    '<li><b>Activation:</b> A one-time $1 fee activates your tag. At activation you ' +
    'choose your plan \u2014 Standard or Premium \u2014 and by activating you agree to that ' +
    'plan. Activation gives you a 30-day period to experience the full service. You ' +
    'may cancel anytime within those 30 days; if you cancel, no further charges are ' +
    'made. If you do not cancel, the plan you chose proceeds automatically as described ' +
    'below.</li>',
    'Step 1b activation line');
  ok('Step 1b - Activation line rewritten (accurate, matches the code)');

  // 1c - rewrite the Standard line.
  terms = replaceOnce(terms,
    '<li><b>Standard plan:</b> $9.99 one-time for the physical sticker, plus $9.99 per year annual subscription (first annual charge at day 30 after direct purchase, or day 60 after $1 activation).</li>',
    '<li><b>Standard plan:</b> If you started from a $1 activation: on day 30 your ' +
    'physical sticker ships and your card is charged $9.99 for it, and on day 60 your ' +
    '$9.99/year annual subscription begins and renews yearly. If you purchase Standard ' +
    'directly (without the $1 activation): you are charged $9.99 today for the sticker, ' +
    'and your $9.99/year annual subscription begins on day 30.</li>',
    'Step 1c standard line');
  ok('Step 1c - Standard line rewritten');

  // 1d - rewrite the Premium line.
  terms = replaceOnce(terms,
    '<li><b>Premium plan:</b> $24.99 one-time for 3 physical stickers (for family), plus $19.99 per year annual subscription. Includes 3 gift codes for family members to register their own account under your subscription.</li>',
    '<li><b>Premium plan:</b> If you started from a $1 activation: on day 30 your 3 ' +
    'physical stickers ship and your card is charged $24.99 for them, and on day 60 ' +
    'your $19.99/year annual subscription begins and renews yearly. If you purchase ' +
    'Premium directly: you are charged $24.99 today for the 3 stickers, and your ' +
    '$19.99/year annual subscription begins on day 30. Premium includes 3 gift codes ' +
    'for family members to register their own account under your subscription.</li>',
    'Step 1d premium line');
  ok('Step 1d - Premium line rewritten');

  // 1e - refresh the "Last updated" date.
  terms = replaceOnce(terms,
    'Effective date: April 20, 2026 \u00b7 Last updated: April 20, 2026',
    'Effective date: April 20, 2026 \u00b7 Last updated: May 26, 2026',
    'Step 1e date');
  ok('Step 1e - "Last updated" date refreshed');

  fs.writeFileSync(termsPath, terms, { encoding: 'utf8' });
  ok('public/terms.html written');
}

// ----------------------------------------------------------------------------
// STEP 2 - privacy.html section 7
// ----------------------------------------------------------------------------
log('');
log('Step 2 - public/privacy.html (Children section)');

const privacyPath = path.join(PUBLIC, 'privacy.html');
let privacy = fs.readFileSync(privacyPath, 'utf8');

if (privacy.indexOf('TMC_PATCH66') !== -1) {
  skip('public/privacy.html');
} else {
  backup(privacyPath, 'public/privacy.html');
  privacy = replaceOnce(privacy,
    "TapMyCar is not intended for children under 13 (COPPA). We do not knowingly collect information from children. If you believe a child has created an account, email us and we'll delete it.",
    "<!-- TMC_PATCH66 -->TapMyCar is intended only for adults aged 18 and older. " +
    "It is not directed to minors, and we do not knowingly collect information from " +
    "anyone under 18. In particular, consistent with the Children's Online Privacy " +
    "Protection Act (COPPA), we never knowingly collect information from children " +
    "under 13. If you believe a minor has created an account, email us and we will " +
    "delete it.",
    'Step 2 privacy children');
  fs.writeFileSync(privacyPath, privacy, { encoding: 'utf8' });
  ok('public/privacy.html written');
}

// ----------------------------------------------------------------------------
// Sync to root
// ----------------------------------------------------------------------------
log('');
log('Sync to root');
['terms.html', 'privacy.html'].forEach(function (name) {
  const pub = path.join(PUBLIC, name);
  const rootCopy = path.join(ROOT, name);
  if (fs.existsSync(rootCopy)) {
    backup(rootCopy, 'root-' + name);
    fs.copyFileSync(pub, rootCopy);
    ok('Synced ' + name + ' -> root');
  }
});

log('');
log('===============================================');
log('Patch 66 applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s, hard-refresh. CHECK:');
log('   - /terms.html section 2: minimum age now 18.');
log('   - /terms.html section 3: Activation / Standard / Premium lines now');
log('     state the $1 -> day-30 sticker charge -> day-60 annual model, with');
log('     no internal contradiction.');
log('   - /terms.html header: "Last updated" shows May 26, 2026.');
log('   - /privacy.html section 7: states an 18+ service, keeps COPPA note.');
log('');
log('  NOTE: these are legal-facing pages. Read the new wording yourself and');
log('  confirm it matches your real policy. If anything is off, tell me the');
log('  exact line and I will correct it. If in doubt on legal language, a');
log('  one-time review by a lawyer is worthwhile before public launch.');
log('');
