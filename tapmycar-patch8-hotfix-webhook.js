// ============================================================================
// TapMyCar — Patch 8: HOTFIX for Patch 7 webhook regression
//
// CRITICAL BUG: Patch 7 added a gate to stripe-webhook.js that requires
// `activation_session_id` in checkout metadata. When that field is missing,
// the webhook does `break;` and skips activation entirely.
//
// REGRESSION: pricing.html does NOT yet pass activation_session_id when
// calling /api/create-checkout. So every paid customer who came through
// pricing.html since Patch 7 deployed has had their webhook activation
// SKIPPED. They paid Stripe but their users.plan stayed 'free' and their
// tag.status stayed unclaimed/inactive.
//
// Confirmed in production: user "Vishnu" (vishnusai2151@gmail.com) paid
// Premium TWICE within an hour, both webhooks logged the
// "PATCH7 CRITICAL: no activation_session_id" error and skipped activation.
// User now has 2 active Stripe subscriptions and users.plan = 'free'.
//
// THE FIX:
// Remove the `break;` from the no-session-id branch. Log a warning
// instead. Activation proceeds whether or not activation_session_id is
// present. When the session_id IS present, we still validate and consume
// it (good security). When it's missing, we log and proceed (avoids the
// regression).
//
// Once pricing.html is updated to send activation_session_id (a future
// patch), the warning will stop appearing for direct-flow purchases.
//
// This patch is INTENTIONALLY MINIMAL because we're under time pressure
// to stop bleeding paying customers. One change, one file.
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch8-hotfix-webhook.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch8-hotfix-webhook.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch8-hotfix-webhook.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch8-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
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

log('');
log('TapMyCar Patch 8 \u2014 HOTFIX: webhook regression');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_8 = 'TMC_PATCH8_HOTFIX';

{
  const file = path.join(API, 'stripe-webhook.js');
  const content = readFile(file);

  if (content.includes(MARKER_8)) {
    skip('stripe-webhook.js (hotfix already applied)');
  } else {
    backup(file);

    // The buggy block, exact:
    const buggyBlock = `        } else {
          console.error('PATCH7 CRITICAL: no activation_session_id in checkout metadata', {
            user_id,
            tag_token,
            session_id: session.id
          });
          break;
        }`;

    const fixedBlock = `        } else {
          // ${MARKER_8}: do NOT break here. pricing.html does not yet pass
          // activation_session_id, so requiring it would block legitimate
          // direct-flow purchases. Log a warning and continue with activation.
          // Once pricing.html is updated to pass session_id (future patch),
          // this branch should rarely fire for legitimate flows.
          console.warn('PATCH8: checkout completed without activation_session_id (allowing for backwards compat)', {
            user_id,
            tag_token,
            session_id: session.id,
            flow
          });
        }`;

    if (!content.includes(buggyBlock)) {
      // Try CRLF variant
      const buggyBlockCRLF = buggyBlock.replace(/\n/g, '\r\n');
      if (content.includes(buggyBlockCRLF)) {
        const fixedBlockCRLF = fixedBlock.replace(/\n/g, '\r\n');
        writeFile(file, content.replace(buggyBlockCRLF, fixedBlockCRLF));
        validateJs(file);
        ok('stripe-webhook.js (CRLF): no-session-id branch no longer blocks activation');
      } else {
        errExit('stripe-webhook.js: expected buggy block not found. File may have drifted.');
      }
    } else {
      writeFile(file, content.replace(buggyBlock, fixedBlock));
      validateJs(file);
      ok('stripe-webhook.js: no-session-id branch no longer blocks activation');
    }
  }
}

log('');
log('==============================================================');
log('Patch 8 (hotfix) complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('IMMEDIATE NEXT STEPS:');
log('');
log('  1. git add -A');
log('  2. git commit -m "Patch 8 HOTFIX: webhook no longer blocks activation when activation_session_id missing"');
log('  3. git push');
log('  4. Wait ~60 seconds for Vercel deploy.');
log('');
log('AFTER deploy, manually fix existing damaged user (Vishnu):');
log('  Run the SQL queries in the chat to fix users.plan, tags.plan, and');
log('  subscription_id. Then refund/cancel duplicate Stripe subscriptions.');
log('');
log('==============================================================');
