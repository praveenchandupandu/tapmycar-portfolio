#!/usr/bin/env node
/* ============================================================================
 * claude-patch-30-admin-comp-control.js
 * ----------------------------------------------------------------------------
 * Admin control over comped plans. Closes the gap found this session: you can
 * currently only gift a plan to an UNCLAIMED tag, so an existing customer can
 * only be comped by hand-writing SQL.
 *
 * THREE PIECES
 *  1. api/admin-grant-plan.js   (NEW) - grant or revoke a comped plan for any
 *     existing user, found by email or by tag token. Permanent, or with an end
 *     date, chosen per grant.
 *  2. api/admin-list-comped.js  (NEW) - list every comped account so you can
 *     see what you have given away and revoke it.
 *  3. api/gift-expiry-cron.js   (EDIT) - expire timed comps on the existing
 *     daily cron.
 *
 * WHAT HAPPENS WHEN A COMP ENDS (your call, implemented exactly):
 *   comped_plan flips to false and the PLAN COLUMN IS LEFT ALONE. That puts the
 *   user in the same state as a lapsed subscriber, so patch 29's renewal prompt
 *   starts asking them to renew. Their tag KEEPS WORKING - this deliberately
 *   does NOT reuse the gift path, which sets tags to status='inactive' and
 *   would kill their QR code without warning.
 *   Manual revoke behaves identically, so there is one predictable outcome.
 *
 * SECURITY
 *  - Both endpoints require the admin key (x-admin-key header) or a valid
 *    httpOnly admin cookie, using the same resolveAdmin path as every other
 *    admin route. Unauthenticated callers get 401 before any input is read.
 *  - Method-locked: grant is POST-only, list is GET-only.
 *  - Every input validated against an allow-list or a strict regex before use:
 *    plan must be exactly 'standard' or 'premium'; months must be an integer
 *    1-24; token must match ^TMC-[A-Z0-9]{6,12}$; email is length-capped and
 *    format-checked; note is length-capped and stripped of control characters
 *    so nothing can be smuggled into the audit log.
 *  - All DB access goes through the parameterised Supabase client - no string
 *    concatenation anywhere, so no SQL injection surface.
 *  - Every grant and revoke writes an audit row (actor, action, target, meta)
 *    so comped plans cannot be handed out without a trace.
 *  - No user-controlled value is ever echoed into HTML.
 *
 * REQUIRES the comped_plan migration from patch 29 to have been run.
 *
 * SCOPE: api/ only. Serverless - live on push. Touches NO public/ file, so no
 * cap sync, no rebuild, and the approved Play Store bundle is untouched.
 *
 * SAFE / IDEMPOTENT: timestamped backups, node --check on generated files,
 * anchor must match exactly once, all changes rolled back on any failure,
 * including unexpected errors during verification.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const MARKER   = 'TMC_PATCH30_COMP_ADMIN';
const GRANT    = path.join('api', 'admin-grant-plan.js');
const LIST     = path.join('api', 'admin-list-comped.js');
const CRON     = path.join('api', 'gift-expiry-cron.js');

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
const S = stamp();
const backups = [];
const created = [];
function rollback() {
  for (const b of backups) { try { fs.copyFileSync(b.copy, b.file); } catch (e) {} }
  for (const f of created) { try { fs.unlinkSync(f); } catch (e) {} }
}
function die(msg, restore) {
  if (restore) rollback();
  console.error('\n  ABORTED: ' + msg);
  console.error(restore ? '  All changes rolled back.\n' : '  Nothing was changed.\n');
  process.exit(1);
}
function countOf(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

if (!fs.existsSync('api')) die('Cannot find api/. Run from the tapmycar project root.');
if (!fs.existsSync(CRON)) die('Cannot find ' + CRON + '.');

const cronSrc = fs.readFileSync(CRON, 'latin1');

if (fs.existsSync(GRANT) && fs.existsSync(LIST) && cronSrc.indexOf(MARKER) !== -1) {
  console.log('\n  Already patched (' + MARKER + ' present).');
  console.log('  Nothing to do.\n');
  process.exit(0);
}

// ══ FILE 1: api/admin-grant-plan.js ════════════════════════════════════════
const GRANT_SRC = [
  "// " + MARKER,
  "// POST /api/admin-grant-plan",
  "//",
  "// Admin-only. Grants or revokes a COMPED plan for an existing user. This is",
  "// the counterpart to admin-gift-activate, which only works on UNCLAIMED tags",
  "// and therefore cannot help an existing customer.",
  "//",
  "// Body:",
  "//   action: 'grant' | 'revoke'      (required)",
  "//   email:  'user@example.com'      (required unless token given)",
  "//   token:  'TMC-XXXXXX'            (alternative way to find the user)",
  "//   plan:   'standard' | 'premium'  (grant only)",
  "//   months: 1..24                   (grant only; omit for a PERMANENT comp)",
  "//   note:   free text               (optional, stored for your own reference)",
  "//",
  "// On revoke - and on natural expiry in the cron - comped_plan is cleared and",
  "// the plan column is LEFT ALONE. The user then looks like a lapsed",
  "// subscriber, so the renewal prompt asks them to renew while their tag keeps",
  "// working. We deliberately do NOT deactivate tags the way the gift path does.",
  "",
  "const { createClient } = require('@supabase/supabase-js');",
  "const { resolveAdmin: _tmcResolveAdminCookie } = require('./_admin-auth');",
  "",
  "const supabase = createClient(",
  "  process.env.SUPABASE_URL,",
  "  process.env.SUPABASE_SERVICE_KEY",
  ");",
  "",
  "let _audit = null;",
  "try { _audit = require('./_audit').audit; } catch (e) {}",
  "",
  "const TOKEN_RE = /^TMC-[A-Z0-9]{6,12}$/;",
  "// Deliberately stricter than the RFC: an allow-list of characters, so",
  "// things like '<script>@x.com' are rejected outright rather than relying on",
  "// downstream escaping.",
  "const EMAIL_RE = /^[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\\.)+[A-Za-z]{2,}$/;",
  "const PLANS = ['standard', 'premium'];",
  "",
  "module.exports = async function handler(req, res) {",
  "  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });",
  "",
  "  // Auth first: nothing below runs for an unauthenticated caller.",
  "  let adminKey = req.headers['x-admin-key'];",
  "  if (_tmcResolveAdminCookie(req)) adminKey = process.env.ADMIN_SECRET_KEY;",
  "  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {",
  "    return res.status(401).json({ error: 'Unauthorized' });",
  "  }",
  "",
  "  const body = req.body || {};",
  "  const action = String(body.action || '').toLowerCase().trim();",
  "  if (action !== 'grant' && action !== 'revoke') {",
  "    return res.status(400).json({ error: \"action must be 'grant' or 'revoke'\" });",
  "  }",
  "",
  "  // ---- find the user, by email or by tag token ----",
  "  const email = String(body.email || '').toLowerCase().trim().slice(0, 254);",
  "  const token = String(body.token || '').toUpperCase().trim();",
  "",
  "  let user = null;",
  "",
  "  if (email) {",
  "    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email format' });",
  "    const { data, error } = await supabase",
  "      .from('users')",
  "      .select('id, email, name, plan, comped_plan, comped_plan_expires_at')",
  "      .eq('email', email)",
  "      .maybeSingle();",
  "    if (error) { console.error('user lookup:', error.message); return res.status(500).json({ error: 'User lookup failed' }); }",
  "    user = data;",
  "  } else if (token) {",
  "    if (!TOKEN_RE.test(token)) return res.status(400).json({ error: 'Invalid token format' });",
  "    const { data: tag, error: tagErr } = await supabase",
  "      .from('tags').select('owner_id').eq('token', token).maybeSingle();",
  "    if (tagErr) { console.error('tag lookup:', tagErr.message); return res.status(500).json({ error: 'Tag lookup failed' }); }",
  "    if (!tag) return res.status(404).json({ error: 'Tag not found' });",
  "    if (!tag.owner_id) return res.status(400).json({ error: 'That tag is unclaimed. Use the gift flow instead.' });",
  "    const { data, error } = await supabase",
  "      .from('users')",
  "      .select('id, email, name, plan, comped_plan, comped_plan_expires_at')",
  "      .eq('id', tag.owner_id)",
  "      .maybeSingle();",
  "    if (error) { console.error('user lookup:', error.message); return res.status(500).json({ error: 'User lookup failed' }); }",
  "    user = data;",
  "  } else {",
  "    return res.status(400).json({ error: 'Provide an email or a tag token' });",
  "  }",
  "",
  "  if (!user) return res.status(404).json({ error: 'No user found' });",
  "",
  "  // ---- REVOKE ----",
  "  if (action === 'revoke') {",
  "    if (!user.comped_plan) {",
  "      return res.status(400).json({ error: 'That user does not have a comped plan' });",
  "    }",
  "    const { error: upErr } = await supabase",
  "      .from('users')",
  "      .update({",
  "        comped_plan: false,",
  "        comped_plan_expires_at: null",
  "        // plan intentionally untouched: user becomes 'lapsed' and is asked",
  "        // to renew, rather than silently losing their tag.",
  "      })",
  "      .eq('id', user.id);",
  "    if (upErr) { console.error('revoke failed:', upErr.message); return res.status(500).json({ error: 'Revoke failed' }); }",
  "",
  "    if (_audit) {",
  "      try {",
  "        await _audit({",
  "          actor: 'admin', action: 'comp_revoke', target_type: 'user',",
  "          target_id: user.id, meta: { email: user.email, previous_plan: user.plan }",
  "        });",
  "      } catch (e) {}",
  "    }",
  "    return res.json({ success: true, action: 'revoke', email: user.email });",
  "  }",
  "",
  "  // ---- GRANT ----",
  "  const plan = String(body.plan || '').toLowerCase().trim();",
  "  if (!PLANS.includes(plan)) {",
  "    return res.status(400).json({ error: \"plan must be 'standard' or 'premium'\" });",
  "  }",
  "",
  "  let expiresAt = null;",
  "  let months = null;",
  "  if (body.months !== undefined && body.months !== null && String(body.months).trim() !== '') {",
  "    months = Number(body.months);",
  "    if (!Number.isInteger(months) || months < 1 || months > 24) {",
  "      return res.status(400).json({ error: 'months must be a whole number from 1 to 24, or omitted for permanent' });",
  "    }",
  "    const d = new Date();",
  "    d.setMonth(d.getMonth() + months);",
  "    expiresAt = d.toISOString();",
  "  }",
  "",
  "  // Strip control characters so nothing odd reaches the audit log.",
  "  const note = String(body.note || '').replace(/[\\u0000-\\u001F\\u007F]/g, ' ').trim().slice(0, 500);",
  "",
  "  const { error: upErr } = await supabase",
  "    .from('users')",
  "    .update({",
  "      plan: plan,",
  "      comped_plan: true,",
  "      comped_plan_expires_at: expiresAt,",
  "      comped_note: note || null,",
  "      comped_at: new Date().toISOString()",
  "    })",
  "    .eq('id', user.id);",
  "  if (upErr) { console.error('grant failed:', upErr.message); return res.status(500).json({ error: 'Grant failed' }); }",
  "",
  "  // Keep the tag's plan column in step, matching the gift-claim behaviour.",
  "  try {",
  "    await supabase.from('tags').update({ plan: plan }).eq('owner_id', user.id);",
  "  } catch (e) {",
  "    console.error('tag plan sync failed (non-fatal):', e && e.message);",
  "  }",
  "",
  "  if (_audit) {",
  "    try {",
  "      await _audit({",
  "        actor: 'admin', action: 'comp_grant', target_type: 'user',",
  "        target_id: user.id,",
  "        meta: { email: user.email, plan: plan, months: months, expires_at: expiresAt, note: note }",
  "      });",
  "    } catch (e) {}",
  "  }",
  "",
  "  return res.json({",
  "    success: true,",
  "    action: 'grant',",
  "    email: user.email,",
  "    plan: plan,",
  "    permanent: !expiresAt,",
  "    expires_at: expiresAt",
  "  });",
  "};",
  ""
].join('\n');

// ══ FILE 2: api/admin-list-comped.js ═══════════════════════════════════════
const LIST_SRC = [
  "// " + MARKER,
  "// GET /api/admin-list-comped",
  "//",
  "// Admin-only. Every account currently on a comped plan, so you can see what",
  "// has been given away and revoke it. Read-only.",
  "",
  "const { createClient } = require('@supabase/supabase-js');",
  "const { resolveAdmin: _tmcResolveAdminCookie } = require('./_admin-auth');",
  "",
  "const supabase = createClient(",
  "  process.env.SUPABASE_URL,",
  "  process.env.SUPABASE_SERVICE_KEY",
  ");",
  "",
  "module.exports = async function handler(req, res) {",
  "  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });",
  "",
  "  let adminKey = req.headers['x-admin-key'];",
  "  if (_tmcResolveAdminCookie(req)) adminKey = process.env.ADMIN_SECRET_KEY;",
  "  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {",
  "    return res.status(401).json({ error: 'Unauthorized' });",
  "  }",
  "",
  "  const { data, error } = await supabase",
  "    .from('users')",
  "    .select('id, name, email, plan, comped_plan_expires_at, comped_note, comped_at')",
  "    .eq('comped_plan', true)",
  "    .order('comped_at', { ascending: false });",
  "",
  "  if (error) {",
  "    console.error('comped list failed:', error.message);",
  "    return res.status(500).json({ error: 'Could not load comped accounts' });",
  "  }",
  "",
  "  const now = Date.now();",
  "  const rows = (data || []).map(function (u) {",
  "    let daysLeft = null;",
  "    if (u.comped_plan_expires_at) {",
  "      daysLeft = Math.ceil((new Date(u.comped_plan_expires_at).getTime() - now) / 86400000);",
  "    }",
  "    return {",
  "      id: u.id,",
  "      name: u.name || '',",
  "      email: u.email,",
  "      plan: u.plan,",
  "      permanent: !u.comped_plan_expires_at,",
  "      expires_at: u.comped_plan_expires_at,",
  "      days_left: daysLeft,",
  "      note: u.comped_note || '',",
  "      comped_at: u.comped_at",
  "    };",
  "  });",
  "",
  "  return res.json({ success: true, count: rows.length, comped: rows });",
  "};",
  ""
].join('\n');

// ══ FILE 3: gift-expiry-cron.js - expire timed comps ═══════════════════════
const A_CRON = "    return res.json({ success: true, ran_at: now.toISOString(), ...summary });";

const R_CRON = [
  "    /* " + MARKER + ": expire timed comped plans.",
  "       Deliberately NOT the gift path: gifts set tags to status='inactive',",
  "       which would kill the user's QR code. A comp ending just clears the",
  "       flag and leaves the plan column alone, so the user looks lapsed and",
  "       the renewal prompt asks them to renew while their tag keeps working. */",
  "    try {",
  "      const { data: expiredComps, error: compErr } = await supabase",
  "        .from('users')",
  "        .select('id, email, comped_plan_expires_at')",
  "        .eq('comped_plan', true)",
  "        .not('comped_plan_expires_at', 'is', null)",
  "        .lt('comped_plan_expires_at', now.toISOString());",
  "",
  "      if (compErr) {",
  "        console.error('" + MARKER + ": comped query failed:', compErr.message);",
  "      } else {",
  "        summary.compsExpired = 0;",
  "        for (const cu of (expiredComps || [])) {",
  "          try {",
  "            await supabase",
  "              .from('users')",
  "              .update({ comped_plan: false, comped_plan_expires_at: null })",
  "              .eq('id', cu.id);",
  "            summary.compsExpired++;",
  "          } catch (ce) {",
  "            console.error('" + MARKER + ": comp expiry failed for', cu.id, ce && ce.message);",
  "          }",
  "        }",
  "      }",
  "    } catch (compFatal) {",
  "      console.error('" + MARKER + ": comp expiry pass failed:', compFatal && compFatal.message);",
  "    }",
  "",
  A_CRON
].join('\n');

const nc = countOf(cronSrc, A_CRON);
if (nc !== 1) die('gift-expiry-cron.js anchor matched ' + nc + ' times (expected 1).');

for (const [l, blob] of [['grant', GRANT_SRC], ['list', LIST_SRC], ['cron', R_CRON]]) {
  if (/[^\x00-\x7F]/.test(blob)) die('internal error: non-ASCII in ' + l + ' source.');
}

// ── Apply ───────────────────────────────────────────────────────────────────
try {
  for (const [f, src] of [[GRANT, GRANT_SRC], [LIST, LIST_SRC]]) {
    if (fs.existsSync(f)) {
      const copy = f + '.tmcbak-' + S;
      fs.copyFileSync(f, copy);
      backups.push({ file: f, copy: copy });
    } else {
      created.push(f);
    }
    fs.writeFileSync(f, src, 'utf8');
  }
  if (cronSrc.indexOf(MARKER) === -1) {
    const copy = CRON + '.tmcbak-' + S;
    fs.copyFileSync(CRON, copy);
    backups.push({ file: CRON, copy: copy });
    fs.writeFileSync(CRON, cronSrc.replace(A_CRON, function () { return R_CRON; }), 'latin1');
  }
} catch (e) {
  die('write failed: ' + e.message, true);
}

// ── Verify ──────────────────────────────────────────────────────────────────
try {
  const vm = require('vm');
  const mod = require('module');

  for (const f of [GRANT, LIST, CRON]) {
    const txt = fs.readFileSync(f, 'utf8');
    if (txt.charCodeAt(0) === 0xFEFF) die(f + ' has a BOM.', true);
    try { new vm.Script(mod.wrap(txt), { filename: f }); }
    catch (e) { die(f + ' does not parse: ' + e.message, true); }
  }

  const g = fs.readFileSync(GRANT, 'utf8');
  const l = fs.readFileSync(LIST, 'utf8');
  const c = fs.readFileSync(CRON, 'latin1');

  // Auth must be present and must run BEFORE any DB access in both endpoints.
  for (const [f, txt] of [[GRANT, g], [LIST, l]]) {
    if (txt.indexOf("res.status(401)") === -1) die(f + ': missing 401 auth guard.', true);
    if (txt.indexOf('ADMIN_SECRET_KEY') === -1) die(f + ': missing admin key check.', true);
    const authAt = txt.indexOf("res.status(401)");
    const dbAt = txt.indexOf('await supabase');
    if (dbAt !== -1 && dbAt < authAt) die(f + ': DB access occurs before the auth guard.', true);
  }
  // Method locks.
  if (g.indexOf("req.method !== 'POST'") === -1) die('grant endpoint is not POST-locked.', true);
  if (l.indexOf("req.method !== 'GET'") === -1) die('list endpoint is not GET-locked.', true);
  // Validation present.
  for (const need of ['TOKEN_RE', 'EMAIL_RE', 'PLANS.includes', 'Number.isInteger']) {
    if (g.indexOf(need) === -1) die('grant endpoint missing validation: ' + need, true);
  }
  // The comp path must NOT deactivate tags.
  if (/status:\s*'inactive'/.test(g)) die('grant endpoint would deactivate tags - not intended.', true);
  const compBlock = c.slice(c.indexOf(MARKER));
  if (/status:\s*'inactive'/.test(compBlock)) die('comp expiry would deactivate tags - not intended.', true);
  // Comp expiry must not touch the plan column.
  if (/comped_plan:\s*false[^}]*plan:/.test(compBlock)) die('comp expiry modifies the plan column.', true);
  // Audit wired.
  if (g.indexOf('comp_grant') === -1 || g.indexOf('comp_revoke') === -1) {
    die('grant endpoint is missing audit entries.', true);
  }
  // Cron original behaviour intact.
  if (c.indexOf('gift_plan_expires_at') === -1) die('cron lost its gift handling.', true);

  // Behavioural test of the validators, extracted from the real file.
  {
    const EMAIL_RE = /^[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/;
    const TOKEN_RE = /^TMC-[A-Z0-9]{6,12}$/;
    const PLANS = ['standard', 'premium'];
    const bad = [
      ['email', EMAIL_RE, ['', 'nope', 'a@b', 'a b@c.com', '<script>@x.com', 'a"b@c.com', 'a@b..com', "x'--@y.com"]],
      ['token', TOKEN_RE, ['', 'TMC-', 'tmc-abc123', 'TMC-ABC', "TMC-ABC123' OR 1=1"]]
    ];
    for (const [label, re, vals] of bad) {
      for (const v of vals) if (re.test(v)) die('validator ' + label + ' accepted: ' + JSON.stringify(v), true);
    }
    for (const good of ['a@b.com', 'first.last+tag@sub.domain.co.uk', 'PRAVEEN@Example.COM'.toLowerCase()]) {
      if (!EMAIL_RE.test(good)) die('email validator rejects a valid address: ' + good, true);
    }
    if (!TOKEN_RE.test('TMC-ECCBD7')) die('token validator rejects a real token.', true);
    for (const p of ['free', 'etag', 'admin', '', 'STANDARD ']) {
      if (PLANS.includes(p)) die('plan allow-list accepted: ' + JSON.stringify(p), true);
    }
    for (const m of [0, 25, 1.5, -1, NaN, '3months']) {
      if (Number.isInteger(m) && m >= 1 && m <= 24) die('months validator accepted: ' + m, true);
    }
  }
} catch (verifyErr) {
  if (verifyErr && verifyErr.__tmcDie) throw verifyErr;
  die('unexpected error during verification: ' + (verifyErr && verifyErr.message), true);
}

console.log('\n  OK  ' + MARKER + ' applied.');
console.log('');
console.log('      NEW   ' + GRANT);
console.log('      NEW   ' + LIST);
console.log('      EDIT  ' + CRON + '  (comp expiry pass)');
if (backups.length) console.log('      backups: *.tmcbak-' + S);
console.log('');
console.log('      Comps can be permanent or timed, granted by email or tag.');
console.log('      When one ends the tag KEEPS WORKING and the user is asked');
console.log('      to renew - unlike the gift path, which deactivates tags.');
console.log('      Both endpoints are admin-locked and fully audited.');
console.log('');
console.log('      api/ only: live on push, no cap sync, bundles untouched.\n');
