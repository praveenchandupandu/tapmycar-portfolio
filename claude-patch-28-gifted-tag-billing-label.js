#!/usr/bin/env node
/* ============================================================================
 * claude-patch-28-gifted-tag-billing-label.js
 * ----------------------------------------------------------------------------
 * Plan & Billing shows "No active subscription / You do not have a recurring
 * plan right now" to ANY user without a Stripe renewal date. For someone on a
 * gifted or comped Standard/Premium plan that reads like an error or a billing
 * failure - they have a real, working plan.
 *
 * AFTER: a user whose plan is a paid tier but who has NO Stripe subscription
 * at all sees "Gifted Tag" and a plain-English explanation instead.
 *
 * WHY THE subStatus GUARD MATTERS (the easy bug here):
 *   A customer who genuinely CANCELLED a paid subscription also has no renewal
 *   date. Labelling them "Gifted Tag" would be wrong and would hide a real
 *   billing state from them. get-billing.js returns subStatus whenever a Stripe
 *   subscription exists in any state, so this patch only shows the gifted label
 *   when subStatus is absent - i.e. there has never been a Stripe subscription.
 *   Cancelled and past-due customers keep the existing message.
 *
 * The existing gift-trial branch (data.giftExpiresAt -> shows the trial end
 * date) runs BEFORE this one and is untouched, so timed gift trials keep
 * showing their expiry. This new branch only catches plans with no expiry and
 * no Stripe record.
 *
 * SECURITY: display-only. No new endpoint, no new request, no user input, no
 * innerHTML (textContent only, so nothing in the response can be rendered as
 * markup), no change to any plan/feature gate. Entitlements are still decided
 * server-side from users.plan; this only changes wording.
 *
 * SCOPE: public/billing.html only. Live on the website on push. Reaches the
 * apps at your next `npx cap sync` - no rebuild forced, approved Play Store
 * bundle untouched.
 *
 * SAFE / IDEMPOTENT: timestamped backup, latin1 byte preservation, ASCII-only
 * insertion, anchor must match exactly once, brace balance + tag balance
 * verified, inserted JS parsed, auto-restore on any failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const TARGET = path.join('public', 'billing.html');
const MARKER = 'TMC_PATCH28_GIFTED_LABEL';

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
let backup = null;
function die(msg, restore) {
  if (restore && backup) { try { fs.copyFileSync(backup, TARGET); } catch (e) {} }
  console.error('\n  ABORTED: ' + msg);
  console.error(restore ? '  ' + TARGET + ' restored from ' + backup + '\n'
                        : '  Nothing was changed.\n');
  process.exit(1);
}
function countOf(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

if (!fs.existsSync(TARGET)) die('Cannot find ' + TARGET + '. Run from the tapmycar project root.');

const src = fs.readFileSync(TARGET, 'latin1');

if (src.indexOf(MARKER) !== -1) {
  console.log('\n  Already patched (' + MARKER + ' found).');
  console.log('  Nothing to do.\n');
  process.exit(0);
}

// ── Anchor ──────────────────────────────────────────────────────────────────
const ANCHOR = [
  "    } else {",
  "      document.getElementById('b-renewal').textContent = 'No active subscription';",
  "      document.getElementById('b-renewal-sub').textContent = 'You do not have a recurring plan right now.';",
  "    }"
].join('\n');

const n = countOf(src, ANCHOR);
if (n !== 1) die('anchor matched ' + n + ' times (expected exactly 1).');

// ── Replacement ─────────────────────────────────────────────────────────────
const REPLACEMENT = [
  "    } else if (!data.subStatus && data.plan && data.plan !== 'etag' && data.plan !== 'free') {",
  "      /* " + MARKER + ": a paid tier with no Stripe subscription at all means",
  "         the plan was gifted or comped. 'No active subscription' reads as a",
  "         billing error to these users. The !data.subStatus guard keeps",
  "         genuinely cancelled or past-due customers on the original message. */",
  "      document.getElementById('b-renewal').textContent = 'Gifted Tag';",
  "      document.getElementById('b-renewal-sub').textContent = 'This plan was gifted to you. There is nothing to pay and no renewal date.';",
  "    } else {",
  "      document.getElementById('b-renewal').textContent = 'No active subscription';",
  "      document.getElementById('b-renewal-sub').textContent = 'You do not have a recurring plan right now.';",
  "    }"
].join('\n');

if (/[^\x00-\x7F]/.test(REPLACEMENT)) die('internal error: non-ASCII in insertion.');

// ── Apply ───────────────────────────────────────────────────────────────────
backup = TARGET + '.tmcbak-' + stamp();
fs.copyFileSync(TARGET, backup);
fs.writeFileSync(TARGET, src.replace(ANCHOR, function () { return REPLACEMENT; }), 'latin1');

// ── Verify ──────────────────────────────────────────────────────────────────
const chk = fs.readFileSync(TARGET, 'latin1');

for (const m of [MARKER, "'Gifted Tag'", '!data.subStatus']) {
  if (chk.indexOf(m) === -1) die('verification failed: "' + m + '" missing.', true);
}
// The original fallback must SURVIVE - cancelled customers still need it.
if (chk.indexOf("textContent = 'No active subscription'") === -1) {
  die('verification failed: original no-subscription branch was lost.', true);
}
// Guard against innerHTML creeping in.
if (REPLACEMENT.indexOf('innerHTML') !== -1) die('internal error: innerHTML in insertion.', true);

// Inserted branch must parse as JavaScript.
try {
  const body = REPLACEMENT.replace(/^\s*\} else if \(/, 'if (').replace(/\} else \{[\s\S]*$/, '}');
  new Function('data', 'document', body);
} catch (e) {
  die('inserted JavaScript does not parse: ' + e.message, true);
}

// Brace + tag balance unchanged apart from our one added branch.
if (countOf(chk, '{') - countOf(src, '{') !== countOf(REPLACEMENT, '{') - countOf(ANCHOR, '{')) {
  die('brace balance changed unexpectedly.', true);
}
for (const tag of ['<script', '</script>', '<body', '</body>', '</html>', '<div', '</div>']) {
  if (countOf(chk, tag) !== countOf(src, tag)) die('HTML structure changed (' + tag + ').', true);
}

const nb = (src.match(/[^\x00-\x7F]/g) || []).length;
const na = (chk.match(/[^\x00-\x7F]/g) || []).length;
if (nb !== na) die('special characters changed (' + nb + ' -> ' + na + ').', true);

console.log('\n  OK  ' + TARGET + ' patched.');
console.log('      backup: ' + backup);
console.log('');
console.log('      Gifted/comped plans now show "Gifted Tag" instead of');
console.log('      "No active subscription".');
console.log('      Cancelled and past-due Stripe customers are UNAFFECTED');
console.log('      (guarded by !data.subStatus).');
console.log('      Display-only: no endpoint, no input, no feature gate,');
console.log('      textContent not innerHTML. Specials preserved (' + na + ').');
console.log('');
console.log('      Website: live on push. Apps: next cap sync only.\n');
