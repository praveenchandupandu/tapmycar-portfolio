// ============================================================================
// TapMyCar - Patch 36b: Correct misleading "Cancel anytime" wording
//
// "Cancel anytime" appears in several paid-purchase descriptions, but the
// REAL policy (api/cancel-subscription.js, SERVICE_FEE_CENTS = 100) is:
//   - refundable within 14 days of the charge, MINUS a $1 service fee
//   - non-refundable after 14 days
//   - activation + sticker fees never refundable
//
// Fix: replace "Cancel anytime" with accurate, professional wording.
//
//   Standalone spots (pricing page, emails, payment-success):
//     "Not satisfied? Request a refund within 14 days - a $1 service fee
//      is retained. After 14 days, the plan is non-refundable."
//
//   The 2 Stripe sticker-line descriptions are already long (shipping +
//   day-30 charge), so they get a trimmed equivalent:
//     "Request a refund within 14 days - a $1 service fee is retained;
//      non-refundable after that."
//
// SCOPE - 10 spots across 4 files:
//   api/create-checkout.js   - upgrade line, renew line, 2 sticker lines
//   api/stripe-webhook.js    - 2 order-confirmation email lines
//   public/payment-success.html - 3 lines
//   public/pricing.html      - 1 line
//
// LEFT ALONE (correct as-is): the $1-trial "Cancel anytime before day 30"
// lines in activate.html, contact.html, landing.html.
//
// Idempotent, safeReplace, per-file backup, JS validation.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch36b-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s);
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p + '  (run from inside the tapmycar project folder)');
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
function replaceAll(content, oldStr, newStr) {
  let count = 0;
  let result = content;
  [oldStr, oldStr.replace(/\n/g, '\r\n')].forEach((variant) => {
    if (variant && result.includes(variant)) {
      const rep = (variant.indexOf('\r\n') !== -1) ? newStr.replace(/\n/g, '\r\n') : newStr;
      while (result.includes(variant)) {
        result = result.replace(variant, () => rep);
        count++;
      }
    }
  });
  return { result, count };
}

log('');
log('TapMyCar Patch 36b \u2014 correct "Cancel anytime" wording');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH36B_CANCEL_WORDING';

/* Full version - standalone spots. */
const FULL = 'Not satisfied? Request a refund within 14 days \u2014 a $1 service fee is retained. After 14 days, the plan is non-refundable.';
/* Trimmed version - appended to already-long Stripe sticker descriptions. */
const TRIM = 'Request a refund within 14 days \u2014 a $1 service fee is retained; non-refundable after that.';

let totalChanges = 0;

// =============================================================================
// api/create-checkout.js  (4 spots)
// =============================================================================
log('api/create-checkout.js');
{
  const file = path.join(API, 'create-checkout.js');
  let content = readFile(file);
  if (content.includes(MARKER)) {
    skip('already patched, skipped');
  } else {
    backup(file);
    const pairs = [
      /* upgrade + renew lines: standalone enough for the full version */
      ['Your Premium plan for one year. Cancel anytime.',
       'Your Premium plan for one year. ' + FULL],
      ['Renews your TapMyCar service for one year and reactivates the tag you already have. Cancel anytime.',
       'Renews your TapMyCar service for one year and reactivates the tag you already have. ' + FULL],
      /* 2 sticker lines: already long -> trimmed version */
      ['On day 30, your $9.99/year annual plan begins. Cancel anytime.',
       'On day 30, your $9.99/year annual plan begins. ' + TRIM],
      ['On day 30, your $19.99/year annual plan begins. Cancel anytime.',
       'On day 30, your $19.99/year annual plan begins. ' + TRIM]
    ];
    let changed = 0;
    for (const [oldS, newS] of pairs) {
      const r = replaceAll(content, oldS, newS);
      content = r.result;
      changed += r.count;
    }
    if (changed === 0) errExit('create-checkout.js: no "Cancel anytime" descriptions matched');
    content = content.replace(/^/, '/* ' + MARKER + ' */\n');
    writeFile(file, content);
    try {
      execSync('node --check "' + file + '"', { stdio: 'pipe' });
    } catch (e) {
      errExit('create-checkout.js JS error: ' + e.stderr.toString());
    }
    ok(changed + ' description(s) corrected, JS valid');
    totalChanges += changed;
  }
}

// =============================================================================
// api/stripe-webhook.js  (2 spots)
// =============================================================================
log('api/stripe-webhook.js');
{
  const file = path.join(API, 'stripe-webhook.js');
  let content = readFile(file);
  if (content.includes(MARKER)) {
    skip('already patched, skipped');
  } else {
    backup(file);
    const pairs = [
      ['Cancel anytime in Settings. Physical stickers are non-refundable once shipped.',
       FULL + ' Physical stickers are non-refundable once shipped.'],
      ['begins your subscription. Cancel anytime.',
       'begins your subscription. ' + FULL]
    ];
    let changed = 0;
    for (const [oldS, newS] of pairs) {
      const r = replaceAll(content, oldS, newS);
      content = r.result;
      changed += r.count;
    }
    if (changed === 0) errExit('stripe-webhook.js: no "Cancel anytime" lines matched');
    content = content.replace(/^/, '/* ' + MARKER + ' */\n');
    writeFile(file, content);
    try {
      execSync('node --check "' + file + '"', { stdio: 'pipe' });
    } catch (e) {
      errExit('stripe-webhook.js JS error: ' + e.stderr.toString());
    }
    ok(changed + ' email line(s) corrected, JS valid');
    totalChanges += changed;
  }
}

// =============================================================================
// public/payment-success.html  (3 spots)
// =============================================================================
log('public/payment-success.html');
{
  const file = path.join(PUBLIC, 'payment-success.html');
  let content = readFile(file);
  if (content.includes(MARKER)) {
    skip('already patched, skipped');
  } else {
    backup(file);
    const pairs = [
      ['Cancel anytime in Settings. Annual subscription refundable within 14 days ($1 service fee retained).',
       FULL],
      ['Your plan renews yearly after that. Cancel anytime in Settings.',
       'Your plan renews yearly after that. ' + FULL]
    ];
    let changed = 0;
    for (const [oldS, newS] of pairs) {
      const r = replaceAll(content, oldS, newS);
      content = r.result;
      changed += r.count;
    }
    if (changed === 0) errExit('payment-success.html: no "Cancel anytime" lines matched');
    content = content.replace(/^/, '<!-- ' + MARKER + ' -->\n');
    writeFile(file, content);
    ok(changed + ' line(s) corrected');
    totalChanges += changed;
  }
}

// =============================================================================
// public/pricing.html  (1 spot)
// =============================================================================
log('public/pricing.html');
{
  const file = path.join(PUBLIC, 'pricing.html');
  let content = readFile(file);
  if (content.includes(MARKER)) {
    skip('already patched, skipped');
  } else {
    backup(file);
    const r = replaceAll(content, 'Cancel anytime in Settings.', FULL);
    content = r.result;
    if (r.count === 0) errExit('pricing.html: "Cancel anytime in Settings." not matched');
    content = content.replace(/^/, '<!-- ' + MARKER + ' -->\n');
    writeFile(file, content);
    ok(r.count + ' line(s) corrected');
    totalChanges += r.count;
  }
}

log('');
log('==============================================================');
log('Patch 36b complete. Total wording changes: ' + totalChanges);
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('New wording (standalone spots):');
log('  "' + FULL + '"');
log('New wording (2 Stripe sticker lines, trimmed):');
log('  "' + TRIM + '"');
log('');
log('Left unchanged (correct): the $1-trial "before day 30" lines in');
log('activate.html, contact.html, landing.html.');
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 36b: clearer cancel/refund wording"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('==============================================================');
