/* tapmycar-patch69-activation-already-verified-fix.js
 *
 * BUG (the real cause of tags never getting claimed / "not in my dashboard"):
 *   When a user's phone is already verified, api/start-phone-verification.js
 *   returns { success:true, already_verified:true } and DOES NOT send an SMS.
 *   The current activate.html ignores that flag, shows the 6-digit code screen,
 *   and the user waits forever for a text that never arrives. They can never
 *   finish verification -> never reach payment -> the tag stays unclaimed
 *   (owner_id NULL, status 'unclaimed').
 *
 * FIX (surgical — touches ONLY pvSendCode() in public/activate.html):
 *   When the backend says already_verified, skip the OTP screen and mint the
 *   activation session directly by calling confirm-phone-verification. The
 *   activation flow then continues straight to payment / claim.
 *
 * Works WITH or WITHOUT Patch 68:
 *   - Without Patch 68: confirm-phone-verification skips Twilio for verified
 *     users (its original behaviour), so the dummy code is accepted.
 *   - With Patch 68: the request carries the signed login token (app.js attaches
 *     it automatically), so the verified-user shortcut is allowed for the
 *     logged-in owner. (A user on a very old pre-Patch-38 session with no signed
 *     token would be asked to sign out and back in — expected.)
 *
 * Safe + idempotent:
 *   - Timestamped backup of activate.html before any change.
 *   - Function-based replacement, matched against the EXACT current pvSendCode.
 *   - Aborts WITHOUT writing if the function isn't in the expected shape.
 *   - Re-running is a no-op (skips if TMC_AV_SHORTCUT marker already present).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP_DIR = path.join(ROOT, 'backup-patch69-' + STAMP);
const TARGET = path.join('public', 'activate.html');
const MARKER = 'TMC_AV_SHORTCUT';

const target = path.join(ROOT, TARGET);
if (!fs.existsSync(target)) {
  throw new Error('Missing ' + TARGET + ' — are you in the tapmycar folder?');
}

let src = fs.readFileSync(target, 'utf8');

if (src.indexOf(MARKER) !== -1) {
  console.log(TARGET + ': already patched (skip).');
  process.exit(0);
}

/* The exact current success-check inside pvSendCode(), immediately before the
 * "Move to code-entry section" lines. We insert the already_verified branch
 * right after the success guard's closing brace.  \r?\n tolerant. */
const find = /(if \(!res\.ok \|\| !data\.success\) \{\r?\n\s*btn\.disabled = false;\r?\n\s*btn\.textContent = 'Send code via SMS';\r?\n\s*showToast\(data\.error \|\| 'Could not send code\. Please try again\.'\);\r?\n\s*return;\r?\n\s*\}\r?\n)(\s*\/\/ Move to code-entry section)/;

const matches = src.match(new RegExp(find.source, 'g'));
const count = matches ? matches.length : 0;
if (count !== 1) {
  throw new Error('Expected exactly 1 match inside pvSendCode(), found ' + count +
    ' — activate.html is not in the expected state. Aborting WITHOUT changes.');
}

const insertion =
  "\n    /* TMC_AV_SHORTCUT (Patch 69): already-verified users get NO SMS from\n" +
  "       the backend, so showing the code screen leaves them waiting forever.\n" +
  "       Mint the activation session directly and continue the flow. */\n" +
  "    if (data.already_verified) {\n" +
  "      try {\n" +
  "        const cres = await fetch('/api/confirm-phone-verification', {\n" +
  "          method: 'POST',\n" +
  "          headers: {'Content-Type':'application/json'},\n" +
  "          body: JSON.stringify({ user_id: s.token, code: '000000' })\n" +
  "        });\n" +
  "        const cdata = await cres.json();\n" +
  "        if (!cres.ok || !cdata.success || !cdata.activation_session_id) {\n" +
  "          btn.disabled = false;\n" +
  "          btn.textContent = 'Send code via SMS';\n" +
  "          showToast(cdata.error || 'Could not start activation. If this keeps happening, sign out and back in, then try again.');\n" +
  "          return;\n" +
  "        }\n" +
  "        if (typeof pvAfterVerifyCallback === 'function') {\n" +
  "          pvAfterVerifyCallback(cdata.activation_session_id);\n" +
  "        } else if (typeof window.pvCallback === 'function') {\n" +
  "          window.pvCallback(cdata.activation_session_id);\n" +
  "        }\n" +
  "        return;\n" +
  "      } catch (ePV) {\n" +
  "        btn.disabled = false;\n" +
  "        btn.textContent = 'Send code via SMS';\n" +
  "        showToast('Network error. Please try again.');\n" +
  "        return;\n" +
  "      }\n" +
  "    }\n";

const out = src.replace(find, function (whole, guardBlock, moveComment) {
  return guardBlock + insertion + moveComment;
});

if (out === src) {
  throw new Error('Replacement produced no change — aborting.');
}

/* Sanity: marker must now be present exactly once. */
if ((out.match(/TMC_AV_SHORTCUT/g) || []).length !== 1) {
  throw new Error('Post-edit sanity check failed — aborting WITHOUT writing.');
}

fs.mkdirSync(path.join(BACKUP_DIR, 'public'), { recursive: true });
fs.copyFileSync(target, path.join(BACKUP_DIR, TARGET));
fs.writeFileSync(target, out, 'utf8');

console.log('OK    ' + TARGET + ' patched.');
console.log('Backup: ' + path.basename(BACKUP_DIR));
