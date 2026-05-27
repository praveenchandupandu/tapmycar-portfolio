/* ============================================================================
 * TapMyCar  Patch 40  Stage 1  admin httpOnly-cookie auth foundation
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch40-stage1-admin-auth.js
 *
 * GOAL OF PATCH 40 (whole): stop the raw admin key from living in the
 * browser. Today the admin page keeps ADMIN_SECRET_KEY in storage and
 * sends it on every request. After Patch 40, the admin logs in once, the
 * server returns a signed httpOnly cookie, and that cookie — which
 * JavaScript cannot read — authenticates every later request. The raw key
 * never gets stored in the browser again.
 *
 * STAGE 1 (this patch) creates THREE NEW FILES and wires NOTHING in yet, so
 * it is 100% backward-compatible — every existing admin flow keeps working
 * exactly as before:
 *
 *   api/_admin-auth.js   - shared helper (HMAC-SHA256 via Node crypto, no
 *                          new dependency, same pattern as Patch 38's
 *                          _auth.js). Provides:
 *                            signAdminSession()    - make a signed token
 *                            verifyAdminSession()  - validate one
 *                            adminCookie()         - build the Set-Cookie
 *                            clearAdminCookie()    - build the expiring one
 *                            readCookie()          - parse a request cookie
 *                            resolveAdmin(req)     - BACKWARD-COMPATIBLE
 *                              check: returns true for a valid httpOnly
 *                              cookie OR any of the legacy key styles the
 *                              15 existing endpoints use today (x-admin-key
 *                              header, ?admin=, ?admin_key=, ?key=,
 *                              body.admin_key). Stage 3 swaps every endpoint
 *                              onto this with zero lockout risk.
 *
 *   api/admin-login.js   - POST { key }. Verifies key against
 *                          ADMIN_SECRET_KEY; on success sets the signed
 *                          httpOnly cookie and returns { success:true }.
 *                          On failure returns 401. Nothing calls this yet
 *                          (Stage 2 points the login form at it).
 *
 *   api/admin-logout.js  - POST. Clears the cookie.
 *
 * USES the existing JWT_SECRET env var (already set in Vercel for Patch 38)
 * to sign the admin cookie — no new env var required. ADMIN_SECRET_KEY is
 * still the thing you type at login; JWT_SECRET only signs the cookie.
 *
 * SAFE TO RE-RUN: each file is only created if missing; existing files are
 * never overwritten (the script reports and skips).
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* ========================================================================
 * FILE 1  api/_admin-auth.js
 * ======================================================================*/
const ADMIN_AUTH = [
"// TMC_PATCH40_ADMIN_AUTH",
"// Shared admin-auth helper for TapMyCar. Signs a short admin session",
"// token with HMAC-SHA256 (Node built-in crypto — no dependency), the same",
"// approach as _auth.js. The token is delivered to the browser as an",
"// httpOnly cookie, so page JavaScript cannot read it (no localStorage /",
"// sessionStorage exposure, immune to XSS theft).",
"//",
"// resolveAdmin(req) is BACKWARD-COMPATIBLE: it returns true for a valid",
"// httpOnly cookie OR for any of the legacy admin-key styles the existing",
"// endpoints use today. That lets Stage 3 migrate every endpoint with no",
"// lockout. Stage 4 (later) drops the legacy styles.",
"",
"const crypto = require('crypto');",
"",
"/* The cookie is SIGNED with JWT_SECRET (already set in Vercel for Patch 38).",
"   ADMIN_SECRET_KEY remains the value typed at login; it is NOT the signing",
"   secret. */",
"const SECRET = process.env.JWT_SECRET || '';",
"const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || '';",
"",
"/* admin session lifetime: 12 hours (admins re-auth more often than users) */",
"const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;",
"const COOKIE_NAME = 'tmc_admin_session';",
"",
"function b64url(buf) {",
"  return Buffer.from(buf).toString('base64')",
"    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');",
"}",
"function b64urlDecode(str) {",
"  str = str.replace(/-/g, '+').replace(/_/g, '/');",
"  while (str.length % 4) str += '=';",
"  return Buffer.from(str, 'base64').toString('utf8');",
"}",
"",
"/* Create a signed admin session token. */",
"function signAdminSession() {",
"  if (!SECRET) throw new Error('JWT_SECRET not set');",
"  const now = Date.now();",
"  const payload = { adm: true, iat: now, exp: now + ADMIN_TTL_MS };",
"  const payloadStr = b64url(JSON.stringify(payload));",
"  const sig = b64url(crypto.createHmac('sha256', SECRET).update(payloadStr).digest());",
"  return payloadStr + '.' + sig;",
"}",
"",
"/* Verify a signed admin token. Returns true if valid + unexpired. */",
"function verifyAdminSession(token) {",
"  try {",
"    if (!SECRET || typeof token !== 'string' || token.indexOf('.') === -1) return false;",
"    const parts = token.split('.');",
"    const payloadStr = parts[0], sig = parts[1];",
"    if (!payloadStr || !sig) return false;",
"    const expected = b64url(crypto.createHmac('sha256', SECRET).update(payloadStr).digest());",
"    if (sig.length !== expected.length) return false;",
"    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;",
"    const payload = JSON.parse(b64urlDecode(payloadStr));",
"    if (!payload || payload.adm !== true) return false;",
"    if (payload.exp && Date.now() > payload.exp) return false;",
"    return true;",
"  } catch (e) {",
"    return false;",
"  }",
"}",
"",
"/* Build the Set-Cookie value for a fresh admin session.",
"   HttpOnly  -> JavaScript cannot read it",
"   Secure    -> only sent over https (tapmycar.io is https)",
"   SameSite=Strict -> not sent on cross-site requests",
"   Path=/    -> sent to every /api/* route */",
"function adminCookie(token) {",
"  const maxAge = Math.floor(ADMIN_TTL_MS / 1000);",
"  return COOKIE_NAME + '=' + token +",
"    '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + maxAge;",
"}",
"",
"/* Build the Set-Cookie value that expires the cookie immediately (logout). */",
"function clearAdminCookie() {",
"  return COOKIE_NAME + '=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';",
"}",
"",
"/* Read a single cookie value from a request's Cookie header. */",
"function readCookie(req, name) {",
"  try {",
"    const header = req.headers && req.headers.cookie;",
"    if (!header) return null;",
"    const parts = header.split(';');",
"    for (let i = 0; i < parts.length; i++) {",
"      const eq = parts[i].indexOf('=');",
"      if (eq === -1) continue;",
"      const k = parts[i].slice(0, eq).trim();",
"      if (k === name) return parts[i].slice(eq + 1).trim();",
"    }",
"    return null;",
"  } catch (e) {",
"    return null;",
"  }",
"}",
"",
"/* Pull a legacy raw admin key from a request, covering every style the",
"   existing 15 admin endpoints use: x-admin-key header, ?admin=,",
"   ?admin_key=, ?key=, body.admin_key, body.admin. */",
"function legacyAdminKey(req) {",
"  const h = req.headers || {};",
"  const q = req.query || {};",
"  const b = req.body || {};",
"  return h['x-admin-key'] || q.admin || q.admin_key || q.key ||",
"         b.admin_key || b.admin || null;",
"}",
"",
"/* BACKWARD-COMPATIBLE admin check. Returns true if the request carries a",
"   valid httpOnly admin cookie OR a correct legacy raw key. Stage 3 points",
"   every admin endpoint at this; Stage 4 later drops the legacy branch. */",
"function resolveAdmin(req) {",
"  /* 1) preferred: signed httpOnly cookie */",
"  const cookieTok = readCookie(req, COOKIE_NAME);",
"  if (cookieTok && verifyAdminSession(cookieTok)) return true;",
"  /* 2) legacy: a correct raw admin key (constant-time compared) */",
"  const raw = legacyAdminKey(req);",
"  if (raw && ADMIN_KEY) {",
"    const a = Buffer.from(String(raw));",
"    const b = Buffer.from(String(ADMIN_KEY));",
"    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;",
"  }",
"  return false;",
"}",
"",
"module.exports = {",
"  signAdminSession, verifyAdminSession,",
"  adminCookie, clearAdminCookie, readCookie,",
"  resolveAdmin, legacyAdminKey,",
"  COOKIE_NAME",
"};",
""
].join('\n');

/* ========================================================================
 * FILE 2  api/admin-login.js
 * ======================================================================*/
const ADMIN_LOGIN = [
"// TMC_PATCH40_ADMIN_LOGIN",
"// POST { key }. Verifies the key against ADMIN_SECRET_KEY. On success,",
"// sets a signed httpOnly admin session cookie and returns { success:true }.",
"// The raw key is never stored in the browser — only this cookie, which",
"// page JavaScript cannot read.",
"//",
"// Stage 1: this endpoint exists but nothing calls it yet. Stage 2 points",
"// the admin login form here.",
"",
"const crypto = require('crypto');",
"const { signAdminSession, adminCookie } = require('./_admin-auth');",
"",
"module.exports = async (req, res) => {",
"  if (req.method !== 'POST') {",
"    return res.status(405).json({ error: 'Method not allowed' });",
"  }",
"",
"  const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || '';",
"  if (!ADMIN_KEY || !process.env.JWT_SECRET) {",
"    return res.status(500).json({ error: 'Server auth not configured' });",
"  }",
"",
"  const body = req.body || {};",
"  const key = body.key != null ? String(body.key) : '';",
"",
"  /* constant-time comparison so a wrong key cannot be timing-probed */",
"  let ok = false;",
"  try {",
"    const a = Buffer.from(key);",
"    const b = Buffer.from(ADMIN_KEY);",
"    ok = (a.length === b.length) && crypto.timingSafeEqual(a, b);",
"  } catch (e) {",
"    ok = false;",
"  }",
"",
"  if (!ok) {",
"    return res.status(401).json({ error: 'Invalid admin key' });",
"  }",
"",
"  try {",
"    const token = signAdminSession();",
"    res.setHeader('Set-Cookie', adminCookie(token));",
"    return res.status(200).json({ success: true });",
"  } catch (e) {",
"    return res.status(500).json({ error: 'Could not start admin session' });",
"  }",
"};",
""
].join('\n');

/* ========================================================================
 * FILE 3  api/admin-logout.js
 * ======================================================================*/
const ADMIN_LOGOUT = [
"// TMC_PATCH40_ADMIN_LOGOUT",
"// POST. Clears the admin session cookie. Always succeeds (idempotent).",
"",
"const { clearAdminCookie } = require('./_admin-auth');",
"",
"module.exports = async (req, res) => {",
"  if (req.method !== 'POST') {",
"    return res.status(405).json({ error: 'Method not allowed' });",
"  }",
"  res.setHeader('Set-Cookie', clearAdminCookie());",
"  return res.status(200).json({ success: true });",
"};",
""
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/
log('\nTapMyCar  Patch 40 Stage 1  admin auth foundation\n');

const NEW_FILES = [
  { path: path.join('api', '_admin-auth.js'),  body: ADMIN_AUTH  },
  { path: path.join('api', 'admin-login.js'),  body: ADMIN_LOGIN },
  { path: path.join('api', 'admin-logout.js'), body: ADMIN_LOGOUT }
];

if (!fs.existsSync('api')) {
  fail('no api/ directory here — run this from the project root.');
}

let created = 0, skipped = 0;
const written = [];

for (const f of NEW_FILES) {
  if (fs.existsSync(f.path)) {
    log(f.path + ': already exists — skipped (not overwritten)');
    skipped++;
    continue;
  }
  fs.writeFileSync(f.path, f.body, 'utf8');   /* UTF-8, no BOM */
  written.push(f.path);
  created++;
  log(f.path + ': created');
}

/* syntax-check everything we wrote; remove any file that fails */
for (const p of written) {
  try {
    execSync('node --check "' + p + '"', { stdio: 'pipe' });
    log('   - node --check ' + p + ': OK');
  } catch (e) {
    fs.unlinkSync(p);   /* roll back this file */
    fail('node --check FAILED for ' + p + ' — the file was removed.\n'
      + String(e.stderr || e.message));
  }
}

log('\nDone. Created: ' + created + (skipped ? ('  Skipped: ' + skipped) : '') + '\n');

if (created > 0) {
  log('These are NEW files only — nothing existing was touched, so this');
  log('deploy changes no behaviour. Stage 2 wires the login form to them.\n');
  log('NEXT STEPS:');
  log('  1. git add -A');
  log('  2. git commit -m "Patch 40 Stage 1: admin httpOnly-cookie auth foundation"');
  log('  3. git push   (wait ~60s for Vercel)');
  log('  4. Quick check: POST to /api/admin-login with a wrong key should');
  log('     return 401; with the correct key, 200 + a Set-Cookie header.\n');
} else {
  log('All three files already existed — nothing to commit.\n');
}
