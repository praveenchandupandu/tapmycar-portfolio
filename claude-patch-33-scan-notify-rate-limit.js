#!/usr/bin/env node
/* ============================================================================
 * claude-patch-33-scan-notify-rate-limit.js
 * ----------------------------------------------------------------------------
 * /api/scan-notify is unauthenticated, unthrottled, and sends a PUSH AND AN
 * EMAIL on every call.
 *
 * THE ATTACK: the tag's UUID is written into window._tagId on every public
 * contact page (contact.html lines 854 and 857). Anyone who scans a tag once -
 * or just opens its page - can read that UUID from the page source and then
 * POST to /api/scan-notify in a loop. Each request pushes to the owner's phone
 * and sends them an email. That is a harassment vector aimed at your customer,
 * and a fast way to get your Resend sending domain flagged for spam.
 *
 * notify-owner.js already defends itself this way (10/hr per IP, 5/hr per tag,
 * TMC_PATCH3_RATE_LIMIT). scan-notify was simply never given the same guard.
 *
 * WHY NOT JUST RESTORE THE COOLDOWN: COOLDOWN_MS is deliberately 0
 * (TMC_PATCH51_NOTHROTTLE) so owners are told about EVERY genuine scan. That is
 * a product decision and this patch does not touch it. Instead it adds an abuse
 * ceiling far above real-world use:
 *
 *     20 per hour per tag   - a real car does not get scanned 20x/hour. A busy
 *                             scene (crowd round a blocked car, a tow driver,
 *                             a few refreshes) stays under it, but the margin
 *                             is tighter than the 40 originally proposed. This
 *                             is a deliberate call by Praveen: prefer a firmer
 *                             ceiling, accept the smaller headroom.
 *     10 per hour per IP    - one source scanning 10x/hour is not a person.
 *                             NOTE: large shared networks (apartment blocks,
 *                             malls, offices) exit through ONE public IP. If
 *                             owners ever report missed alerts at such a site,
 *                             this is the number to raise first - not the tag
 *                             one.
 *
 * Legitimate scans are unaffected. Only floods are stopped.
 *
 * FAIL-OPEN BY DESIGN: the shared limiter is backed by storage that can fail.
 * If a limit check throws, the notification is still sent. Missing a rate limit
 * is a much smaller problem than silently swallowing a real scan alert - the
 * alert is the core product promise. This mirrors how the limiter is already
 * used elsewhere.
 *
 * ORDERING: both checks run BEFORE the tag lookup, so a flood costs no database
 * work, no Resend call, and no push send.
 *
 * SECURITY: adds a restriction, removes none. No new endpoint, no new input, no
 * change to who can call what. The per-tag key uses the tag_id already supplied
 * in the body; it is coerced with String() and used only as a rate-limit key,
 * never in a query.
 *
 * SCOPE: api/scan-notify.js only. Serverless - live on push, no cap sync, no
 * rebuild, approved Play Store bundle untouched.
 *
 * SAFE / IDEMPOTENT: timestamped backup, anchor must match exactly once, file
 * re-parsed after edit, ordering asserted, auto-restore on any failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const TARGET = path.join('api', 'scan-notify.js');
const LIMITER = path.join('api', '_rate-limit.js');
const MARKER = 'TMC_PATCH33_SCAN_RATE_LIMIT';
const TAG_MAX = 20;   // per hour, per tag
const IP_MAX  = 10;   // per hour, per source IP

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
if (!fs.existsSync(LIMITER)) die('Cannot find ' + LIMITER + ' - the shared rate limiter is missing.');

const limiterSrc = fs.readFileSync(LIMITER, 'latin1');
if (limiterSrc.indexOf('module.exports = { getClientIp, checkRateLimit, rateLimit }') === -1) {
  die('_rate-limit.js does not export the expected helpers.');
}

const src = fs.readFileSync(TARGET, 'latin1');

/* If an earlier build of this patch is already in the file, do not bail out -
   retune the two numbers in place. This makes the patch safe to run whether or
   not the first version was already deployed. */
if (src.indexOf(MARKER) !== -1) {
  const curTag = /scan-notify:tag:[^}]*max:\s*(\d+)/.exec(src);
  const curIp  = /scan-notify:ip:[^}]*max:\s*(\d+)/.exec(src);
  if (!curTag || !curIp) die('patch marker present but the limits could not be read - inspect the file by hand.');

  if (Number(curTag[1]) === TAG_MAX && Number(curIp[1]) === IP_MAX) {
    console.log('\n  Already patched, limits already ' + TAG_MAX + '/hr per tag and ' + IP_MAX + '/hr per IP.');
    console.log('  Nothing to do.\n');
    process.exit(0);
  }

  backup = TARGET + '.tmcbak-' + stamp();
  fs.copyFileSync(TARGET, backup);

  let tuned = src.replace(/(scan-notify:tag:[^}]*max:\s*)\d+/, '$1' + TAG_MAX)
                 .replace(/(scan-notify:ip:[^}]*max:\s*)\d+/,  '$1' + IP_MAX);
  fs.writeFileSync(TARGET, tuned, 'latin1');

  const rechk = fs.readFileSync(TARGET, 'latin1');
  try { new (require('vm').Script)(require('module').wrap(rechk), { filename: TARGET }); }
  catch (e) { die(TARGET + ' no longer parses: ' + e.message, true); }
  const vTag = /scan-notify:tag:[^}]*max:\s*(\d+)/.exec(rechk);
  const vIp  = /scan-notify:ip:[^}]*max:\s*(\d+)/.exec(rechk);
  if (!vTag || Number(vTag[1]) !== TAG_MAX) die('retune failed for the per-tag limit.', true);
  if (!vIp  || Number(vIp[1])  !== IP_MAX)  die('retune failed for the per-IP limit.', true);
  if (rechk.indexOf('const COOLDOWN_MS = 0;') === -1) die('COOLDOWN_MS changed unexpectedly.', true);

  console.log('\n  OK  limits retuned in ' + TARGET + '.');
  console.log('      backup: ' + backup);
  console.log('      ' + curTag[1] + '/hr per tag -> ' + TAG_MAX + '/hr per tag');
  console.log('      ' + curIp[1]  + '/hr per IP  -> ' + IP_MAX  + '/hr per IP\n');
  process.exit(0);
}

// ── Anchor 1: the require block ────────────────────────────────────────────
const A_REQ = "const { sendPushToUser } = require('./_push-send');";
if (countOf(src, A_REQ) !== 1) die('require anchor not found exactly once.');

const R_REQ = [
  A_REQ,
  "/* " + MARKER + " */",
  "const { rateLimit, getClientIp } = require('./_rate-limit');"
].join('\n');

// ── Anchor 2: just after tag_id is validated ───────────────────────────────
const A_GATE = [
  "  const tag_id = req.body && req.body.tag_id;",
  "  if (!tag_id) return res.status(400).json({ error: 'tag_id required' });"
].join('\n');
if (countOf(src, A_GATE) !== 1) die('tag_id validation anchor not found exactly once.');

const R_GATE = [
  A_GATE,
  "",
  "  /* " + MARKER + ": abuse ceiling.",
  "     The tag UUID is public - it is written into window._tagId on every",
  "     contact page - so anyone can POST here and make the owner's phone buzz",
  "     and their inbox fill. These limits sit far above real-world scanning so",
  "     genuine alerts are never dropped; COOLDOWN_MS stays 0 and owners still",
  "     hear about every real scan.",
  "",
  "     Runs BEFORE the tag lookup so a flood costs no DB, email or push work.",
  "",
  "     Fail-open: if the limiter itself errors we still send. Losing a real",
  "     scan alert is worse than losing a rate limit. */",
  "  try {",
  "    const _tmcIp = getClientIp(req);",
  "    if (!await rateLimit(req, res, [",
  "      { key: 'scan-notify:tag:' + String(tag_id), max: 20, windowSeconds: 3600 },",
  "      { key: 'scan-notify:ip:' + _tmcIp, max: 10, windowSeconds: 3600 }",
  "    ])) return;",
  "  } catch (rlErr) {",
  "    console.error('" + MARKER + ": limiter unavailable, allowing through:', rlErr && rlErr.message);",
  "  }"
].join('\n');

for (const [l, blob] of [['req', R_REQ], ['gate', R_GATE]]) {
  if (/[^\x00-\x7F]/.test(blob)) die('internal error: non-ASCII in ' + l + ' insertion.');
}

// ── Apply ───────────────────────────────────────────────────────────────────
backup = TARGET + '.tmcbak-' + stamp();
fs.copyFileSync(TARGET, backup);

let out = src.replace(A_REQ, function () { return R_REQ; });
out = out.replace(A_GATE, function () { return R_GATE; });
fs.writeFileSync(TARGET, out, 'latin1');

// ── Verify ──────────────────────────────────────────────────────────────────
try {
  const chk = fs.readFileSync(TARGET, 'latin1');

  for (const need of [MARKER, "require('./_rate-limit')", 'scan-notify:tag:', 'scan-notify:ip:', 'getClientIp(req)']) {
    if (chk.indexOf(need) === -1) die('verification failed: "' + need + '" missing.', true);
  }

  // Must still parse.
  try { new (require('vm').Script)(require('module').wrap(chk), { filename: TARGET }); }
  catch (e) { die(TARGET + ' no longer parses: ' + e.message, true); }

  // The limit must run BEFORE the tag lookup, or a flood still hits the DB.
  const iLimit = chk.indexOf("scan-notify:tag:");
  const iLookup = chk.indexOf(".from('tags')");
  if (iLookup === -1) die('could not locate the tag lookup.', true);
  if (iLimit > iLookup) die('rate limit runs AFTER the tag lookup - flood would still hit the DB.', true);

  // Deliberate product behaviour must be untouched.
  if (chk.indexOf('const COOLDOWN_MS = 0;') === -1) {
    die('COOLDOWN_MS changed - patch 51 intent (notify on every scan) must be preserved.', true);
  }

  // Existing behaviour intact.
  for (const need of ['sendPushToUser', "req.method !== 'POST'", 'scan_notify_state']) {
    if (chk.indexOf(need) === -1) die('lost existing logic: ' + need, true);
  }

  // Exactly one require added, no duplicates.
  if (countOf(chk, "require('./_rate-limit')") !== 1) die('duplicate limiter require.', true);

  // Limits must be sane: high enough not to drop real scans.
  const tagMax = /scan-notify:tag:[^}]*max:\s*(\d+)/.exec(chk);
  const ipMax  = /scan-notify:ip:[^}]*max:\s*(\d+)/.exec(chk);
  if (!tagMax || !ipMax) die('could not read the configured limits.', true);
  if (Number(tagMax[1]) < 20) die('per-tag limit too low (' + tagMax[1] + ') - would drop real scan alerts.', true);
  if (Number(ipMax[1]) < 10) die('per-IP limit too low (' + ipMax[1] + ').', true);
  if (Number(tagMax[1]) !== TAG_MAX || Number(ipMax[1]) !== IP_MAX) {
    die('limits in file (' + tagMax[1] + '/' + ipMax[1] + ') do not match intended ' + TAG_MAX + '/' + IP_MAX + '.', true);
  }

  const nb = (src.match(/[^\x00-\x7F]/g) || []).length;
  const na = (chk.match(/[^\x00-\x7F]/g) || []).length;
  if (nb !== na) die('special characters changed (' + nb + ' -> ' + na + ').', true);

  console.log('\n  OK  ' + TARGET + ' patched.');
  console.log('      backup: ' + backup);
  console.log('');
  console.log('      Limits: ' + tagMax[1] + '/hr per tag, ' + ipMax[1] + '/hr per IP.');
  console.log('      Checked BEFORE the tag lookup, so floods cost nothing.');
  console.log('      COOLDOWN_MS still 0 - owners hear about every real scan.');
  console.log('      Fail-open: limiter errors never swallow a real alert.');
  console.log('');
  console.log('      api/ only: live on push, no cap sync, bundles untouched.\n');
} catch (verifyErr) {
  if (verifyErr && verifyErr.__tmcDie) throw verifyErr;
  die('unexpected error during verification: ' + (verifyErr && verifyErr.message), true);
}
