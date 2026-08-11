#!/usr/bin/env node
/* ============================================================================
 * claude-patch-24-number-pool-routing.js
 * ----------------------------------------------------------------------------
 * Makes call routing EXACT by giving each tap its own phone number.
 *
 * BEFORE: every stranger dialled the same number, and inbound-call.js guessed
 *   which owner to ring based on who tapped most recently. Two overlapping
 *   callers, or one abandoned tap, could ring the wrong owner.
 *
 * AFTER:
 *   register-pending-call.js reserves a free number from the call_numbers
 *   pool for 2 minutes and returns it to the page.
 *   inbound-call.js reads Twilio's "To" field -- the number that was actually
 *   dialled -- and looks up who reserved it. The dialled number IS the
 *   identity, so there is nothing to guess. Two people who tap in the same
 *   millisecond get different numbers and both route correctly.
 *
 * ALSO FIXED: every inbound call is now logged, including ones we cannot
 *   match (direct dials, expired taps, wrong numbers). Previously the early
 *   return sat above the call_logs insert and those calls vanished, losing
 *   the caller's number.
 *
 * FALLBACK: if all pool numbers are busy, the page falls back to the main
 *   number and the old timing match still applies for that call only. Rare
 *   with 4 numbers, and better than showing a stranger an error.
 *
 * The owner still always sees your main number as caller ID -- unchanged.
 *
 * REQUIRES: the call_numbers table (already created).
 * SCOPE: api/ only. Deploys via git push. Does NOT touch the approved Android
 * bundle -- no public/, no android/, no cap sync, no rebuild.
 *
 * SAFE / IDEMPOTENT: timestamped backups, UTF-8 no-BOM, latin1 byte
 * preservation, ASCII-only insertions, every anchor must match exactly once,
 * node --check with automatic restore of ALL files on any failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MARKER = 'TMC_PATCH24_POOL';
const F_REG = path.join('api', 'register-pending-call.js');
const F_IN  = path.join('api', 'inbound-call.js');

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

const backups = [];
function restoreAll() {
  for (const b of backups) {
    try { fs.copyFileSync(b.backup, b.target); } catch (e) {}
  }
}
function die(msg, restore) {
  if (restore) restoreAll();
  console.error('\n  ABORTED: ' + msg);
  console.error(restore ? '  All files restored from backups.\n' : '  Nothing was changed.\n');
  process.exit(1);
}
function countOf(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

// ── Pre-flight ──────────────────────────────────────────────────────────────
for (const f of [F_REG, F_IN]) {
  if (!fs.existsSync(f)) die('Cannot find ' + f + '. Run this from the tapmycar project root.');
}

let srcReg = fs.readFileSync(F_REG, 'latin1');
let srcIn  = fs.readFileSync(F_IN,  'latin1');

if (srcReg.indexOf(MARKER) !== -1 || srcIn.indexOf(MARKER) !== -1) {
  console.log('\n  Already patched (' + MARKER + ' found).');
  console.log('  Nothing to do.\n');
  process.exit(0);
}

// ══ FILE 1: register-pending-call.js ════════════════════════════════════════

const A_REG = [
  "  return res.json({ success: true, pending_id: row.id });",
  "};"
].join('\n');

const R_REG = [
  "  // " + MARKER + ": reserve a pool number for this tag.",
  "  // The stranger will dial THIS number, so when the call arrives we know",
  "  // exactly which tag it belongs to -- no timing guess involved.",
  "  // A number counts as free if it was never reserved, or its reservation",
  "  // has expired. Expired rows are reused automatically, so no cleanup job.",
  "  const RESERVE_MS = 2 * 60 * 1000;",
  "  const nowIso = new Date().toISOString();",
  "  const untilIso = new Date(Date.now() + RESERVE_MS).toISOString();",
  "  const FREE = 'reserved_until.is.null,reserved_until.lt.' + nowIso;",
  "",
  "  let reservedNumber = null;",
  "  try {",
  "    for (let attempt = 0; attempt < 5; attempt++) {",
  "      const { data: candidate } = await supabase",
  "        .from('call_numbers')",
  "        .select('id')",
  "        .eq('active', true)",
  "        .or(FREE)",
  "        .order('reserved_until', { ascending: true, nullsFirst: true })",
  "        .limit(1)",
  "        .maybeSingle();",
  "      if (!candidate) break; // pool exhausted right now",
  "",
  "      // Atomic claim: the .or(FREE) on the UPDATE means only one request",
  "      // can win a given row. A loser simply tries the next free number.",
  "      const { data: claimed } = await supabase",
  "        .from('call_numbers')",
  "        .update({",
  "          reserved_tag_id: tag.id,",
  "          reserved_tag_token: cleanToken,",
  "          reserved_owner_user_id: tag.users.id,",
  "          reserved_owner_phone: tag.users.phone,",
  "          reserved_at: nowIso,",
  "          reserved_until: untilIso",
  "        })",
  "        .eq('id', candidate.id)",
  "        .or(FREE)",
  "        .select('phone_number')",
  "        .maybeSingle();",
  "      if (claimed && claimed.phone_number) { reservedNumber = claimed.phone_number; break; }",
  "    }",
  "  } catch (e) {",
  "    console.error('call_numbers reserve error:', e && e.message);",
  "  }",
  "",
  "  // If the pool is full, fall back to the main number. That call routes by",
  "  // the old timing match -- not exact, but better than refusing the caller.",
  "  const dialNumber = reservedNumber || process.env.TWILIO_PHONE_NUMBER || null;",
  "  if (!reservedNumber) console.warn('call_numbers pool exhausted, falling back to main number');",
  "",
  "  return res.json({",
  "    success: true,",
  "    pending_id: row.id,",
  "    dial_number: dialNumber,",
  "    pooled: !!reservedNumber",
  "  });",
  "};"
].join('\n');

// ══ FILE 2: inbound-call.js ═════════════════════════════════════════════════

const A_IN_1 = [
  "  const strangerNumber = (req.body && req.body.From) || (req.query && req.query.From) || '';",
  ""
].join('\n');

const R_IN_1 = [
  "  const strangerNumber = (req.body && req.body.From) || (req.query && req.query.From) || '';",
  "  // " + MARKER + ": the number the stranger actually dialled.",
  "  const dialedNumber = (req.body && req.body.To) || (req.query && req.query.To) || '';",
  ""
].join('\n');

const A_IN_2 = [
  "  // Look up the most recent pending_calls row from the last 5 minutes.",
  "  // (No way to match by caller ID since stranger never gave it to us.)",
  "  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();",
  "  const { data: pending } = await supabase",
  "    .from('pending_calls')",
  "    .select('id, tag_id, tag_token, owner_user_id, owner_phone')",
  "    .gte('created_at', fiveMinAgo)",
  "    .order('created_at', { ascending: false })",
  "    .limit(1)",
  "    .maybeSingle();",
  "",
  "  if (!pending) {",
  "    // Nobody recently tapped Call. Refuse politely.",
  "    return res.send(`<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
  "<Response>",
  "  <Say voice=\"${VOICE}\">Sorry, we don't recognize this call. Please tap the Call button on the TapMyCar page first, then try calling again. Goodbye!</Say>",
  "  <Pause length=\"1\"/>",
  "  <Hangup/>",
  "</Response>`);",
  "  }",
  ""
].join('\n');

const R_IN_2 = [
  "  // " + MARKER + ": EXACT MATCH. Look up who reserved the dialled number.",
  "  // This is the whole point of the pool -- the number carries the identity,",
  "  // so there is no window, no ordering and no guessing.",
  "  let pending = null;",
  "  let matchSource = 'none';",
  "",
  "  if (dialedNumber) {",
  "    try {",
  "      const { data: slot } = await supabase",
  "        .from('call_numbers')",
  "        .select('id, reserved_tag_id, reserved_tag_token, reserved_owner_user_id, reserved_owner_phone, reserved_until')",
  "        .eq('phone_number', dialedNumber)",
  "        .maybeSingle();",
  "",
  "      const live = slot && slot.reserved_until &&",
  "                   new Date(slot.reserved_until).getTime() > Date.now() &&",
  "                   slot.reserved_owner_phone;",
  "",
  "      if (live) {",
  "        pending = {",
  "          id: null,",
  "          tag_id: slot.reserved_tag_id,",
  "          tag_token: slot.reserved_tag_token,",
  "          owner_user_id: slot.reserved_owner_user_id,",
  "          owner_phone: slot.reserved_owner_phone",
  "        };",
  "        matchSource = 'pool';",
  "",
  "        // Release straight away so the number is reusable for the next tap.",
  "        await supabase.from('call_numbers').update({",
  "          reserved_tag_id: null,",
  "          reserved_tag_token: null,",
  "          reserved_owner_user_id: null,",
  "          reserved_owner_phone: null,",
  "          reserved_at: null,",
  "          reserved_until: null",
  "        }).eq('id', slot.id);",
  "      }",
  "    } catch (e) {",
  "      console.error('call_numbers lookup error:', e && e.message);",
  "    }",
  "  }",
  "",
  "  // FALLBACK: main number, or pool was exhausted when they tapped. Uses the",
  "  // old recency match. Not exact, but only reached when the pool did not",
  "  // hand out a number for this call.",
  "  if (!pending) {",
  "    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();",
  "    const { data: recent } = await supabase",
  "      .from('pending_calls')",
  "      .select('id, tag_id, tag_token, owner_user_id, owner_phone')",
  "      .eq('consumed', false)",
  "      .gte('created_at', fiveMinAgo)",
  "      .order('created_at', { ascending: false })",
  "      .limit(1)",
  "      .maybeSingle();",
  "    if (recent) { pending = recent; matchSource = 'pending_recent'; }",
  "  }",
  "",
  "  console.log('inbound-call match source: ' + matchSource + ' to=' + dialedNumber);",
  "",
  "  if (!pending) {",
  "    // " + MARKER + ": log EVERY inbound call, including unmatched ones, so",
  "    // the caller's number is never lost. tag/owner columns are nullable.",
  "    try {",
  "      const { error: logErr } = await supabase",
  "        .from('call_logs')",
  "        .insert({",
  "          stranger_phone: strangerNumber,",
  "          owner_phone: dialedNumber,",
  "          twilio_call_sid: callSid,",
  "          status: 'no_pending_match'",
  "        });",
  "      if (logErr) console.error('call_logs unmatched insert error:', logErr.message);",
  "    } catch (e) { console.error('call_logs unmatched insert threw:', e && e.message); }",
  "",
  "    // Nobody recently tapped Call. Refuse politely.",
  "    return res.send(`<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
  "<Response>",
  "  <Say voice=\"${VOICE}\">Sorry, we don't recognize this call. Please tap the Call button on the TapMyCar page first, then try calling again. Goodbye!</Say>",
  "  <Pause length=\"1\"/>",
  "  <Hangup/>",
  "</Response>`);",
  "  }",
  ""
].join('\n');

const A_IN_3 = [
  "  // Mark pending consumed (so a second concurrent call doesn't pick this up)",
  "  await supabase.from('pending_calls').update({ consumed: true }).eq('id', pending.id);",
  ""
].join('\n');

const R_IN_3 = [
  "  // " + MARKER + ": only the fallback path has a pending_calls row to close.",
  "  // Pool matches were released the moment they were claimed.",
  "  if (pending.id) {",
  "    await supabase.from('pending_calls').update({ consumed: true }).eq('id', pending.id);",
  "  }",
  ""
].join('\n');

// ── Anchor checks (all must be exactly 1 before anything is written) ────────
const checks = [
  [srcReg, A_REG,  'register-pending-call return block'],
  [srcIn,  A_IN_1, 'inbound-call From line'],
  [srcIn,  A_IN_2, 'inbound-call pending lookup block'],
  [srcIn,  A_IN_3, 'inbound-call consumed update']
];
for (const [src, anchor, label] of checks) {
  const c = countOf(src, anchor);
  if (c !== 1) die(label + ' matched ' + c + ' times (expected exactly 1)');
}

// ── ASCII guard on everything we insert ────────────────────────────────────
const inserted = R_REG + R_IN_1 + R_IN_2 + R_IN_3;
if (/[^\x00-\x7F]/.test(inserted)) {
  die('internal error: patch tried to insert non-ASCII text.');
}

// ── Apply ───────────────────────────────────────────────────────────────────
const s = stamp();
for (const t of [F_REG, F_IN]) {
  const b = t + '.tmcbak-' + s;
  fs.copyFileSync(t, b);
  backups.push({ target: t, backup: b });
}

let outReg = srcReg.replace(A_REG, function () { return R_REG; });
let outIn  = srcIn.replace(A_IN_1, function () { return R_IN_1; });
outIn      = outIn.replace(A_IN_2, function () { return R_IN_2; });
outIn      = outIn.replace(A_IN_3, function () { return R_IN_3; });

fs.writeFileSync(F_REG, outReg, 'latin1');
fs.writeFileSync(F_IN,  outIn,  'latin1');

// ── Verify ──────────────────────────────────────────────────────────────────
for (const t of [F_REG, F_IN]) {
  try {
    execFileSync(process.execPath, ['--check', t], { stdio: 'pipe' });
  } catch (e) {
    die('node --check failed on ' + t + '\n  ' +
        String((e.stderr || e.stdout || e.message)).trim(), true);
  }
}

const chkReg = fs.readFileSync(F_REG, 'latin1');
const chkIn  = fs.readFileSync(F_IN,  'latin1');
const musts = [
  [chkReg, "dial_number: dialNumber",                 'reserve returns dial_number'],
  [chkReg, "from('call_numbers')",                    'reserve queries call_numbers'],
  [chkIn,  "const dialedNumber",                      'inbound reads To'],
  [chkIn,  "matchSource = 'pool'",                    'inbound has pool match'],
  [chkIn,  "status: 'no_pending_match'",              'inbound logs unmatched'],
  [chkIn,  "if (pending.id) {",                       'inbound guards consumed update']
];
for (const [src, needle, label] of musts) {
  if (src.indexOf(needle) === -1) die('verification failed: ' + label, true);
}
if (countOf(chkIn, "await supabase.from('pending_calls').update({ consumed: true })") !== 1) {
  die('verification failed: consumed update not exactly once', true);
}

console.log('\n  OK  both files patched.');
for (const b of backups) console.log('      backup: ' + b.backup);
console.log('');
console.log('      register-pending-call.js  -> reserves a pool number (2 min)');
console.log('                                   and returns it as dial_number');
console.log('      inbound-call.js           -> routes by the number DIALLED');
console.log('                                   (exact), falls back to the old');
console.log('                                   timing match on the main number,');
console.log('                                   and logs every call either way');
console.log('');
console.log('      Backend only -- Android bundle untouched.');
console.log('      Routing goes exact once the contact page change ships too.\n');
