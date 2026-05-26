// ============================================================================
// TapMyCar - Patch 38 (Stage 1 of 5): Auth foundation
//
// SECURITY CONTEXT
// The user-data endpoints currently identify the caller purely by a
// user_id (a raw UUID) passed in the request, and trust it. Anyone who
// obtains another user's UUID could read or modify that user's data
// (an IDOR vulnerability). The fix is a signed session token system.
//
// THIS STAGE (1 of 5) IS ZERO-RISK
// It only creates ONE NEW FILE: api/_auth.js. It does not modify any
// existing endpoint, page, or behaviour. Nothing about the live site
// changes. It just puts the tools in place for Stages 2-4.
//
// WHAT api/_auth.js PROVIDES
//   signSession(userId)   -> a signed token string (HMAC-SHA256, no
//                            external library - uses Node's built-in
//                            crypto, so nothing to install).
//   verifySession(token)  -> returns { userId } if the token is a valid
//                            signed token, else null.
//   resolveUser(req)      -> the BACKWARD-COMPATIBLE resolver used by
//                            Stage 4. It accepts EITHER:
//                              (a) a new signed token, OR
//                              (b) the legacy raw UUID
//                            and returns { userId, viaLegacy }. This is
//                            what guarantees existing logged-in users
//                            are NOT logged out when Stage 4 ships.
//
// REQUIRED ENV VAR (set this before Stage 2):
//   JWT_SECRET - any long random string (32+ chars). Add it in
//   Vercel -> Settings -> Environment Variables. Stage 1 works without
//   it being used yet, but set it now so it is ready.
//
// Idempotent. Creates a new file only. Validates JS.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

log('');
log('TapMyCar Patch 38 \u2014 Stage 1 of 5: auth foundation');
log('');

const file = path.join(API, '_auth.js');

if (fs.existsSync(file)) {
  const existing = fs.readFileSync(file, 'utf8');
  if (existing.includes('TMC_PATCH38_AUTH_FOUNDATION')) {
    skip('api/_auth.js');
    process.exit(0);
  }
  errExit('api/_auth.js exists without marker \u2014 manual review needed');
}

const body = `// TMC_PATCH38_AUTH_FOUNDATION
// Shared auth helper for TapMyCar. Signed session tokens using Node's
// built-in crypto (HMAC-SHA256) - no external dependency.
//
// A token looks like:  base64url(payloadJson).base64url(signature)
// payload = { uid: <userId>, iat: <issued-at-ms>, exp: <expiry-ms> }
//
// resolveUser(req) is BACKWARD-COMPATIBLE: it accepts a new signed token
// OR a legacy raw UUID, so existing logged-in users keep working when the
// sensitive endpoints adopt this in Stage 4.

const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET || '';
/* token lifetime: 90 days (users stay logged in like before) */
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

/* Is this string a UUID (legacy token)? */
function isUuid(s) {
  return typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

/* Create a signed session token for a user id. */
function signSession(userId) {
  if (!SECRET) throw new Error('JWT_SECRET not set');
  const now = Date.now();
  const payload = { uid: String(userId), iat: now, exp: now + TOKEN_TTL_MS };
  const payloadStr = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(payloadStr).digest());
  return payloadStr + '.' + sig;
}

/* Verify a signed token. Returns { userId } or null. */
function verifySession(token) {
  try {
    if (!SECRET || typeof token !== 'string' || token.indexOf('.') === -1) return null;
    const [payloadStr, sig] = token.split('.');
    if (!payloadStr || !sig) return null;
    /* recompute signature and compare in constant time */
    const expected = b64url(crypto.createHmac('sha256', SECRET).update(payloadStr).digest());
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(b64urlDecode(payloadStr));
    if (!payload || !payload.uid) return null;
    if (payload.exp && Date.now() > payload.exp) return null; /* expired */
    return { userId: String(payload.uid) };
  } catch (e) {
    return null;
  }
}

/* Pull the raw token from a request: Authorization: Bearer xxx,
   or body.token / body.user_id, or query.token / query.user_id. */
function extractToken(req) {
  const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (auth && /^Bearer\\s+/i.test(auth)) return auth.replace(/^Bearer\\s+/i, '').trim();
  if (req.body && (req.body.token || req.body.user_id)) {
    return String(req.body.token || req.body.user_id).trim();
  }
  if (req.query && (req.query.token || req.query.user_id)) {
    return String(req.query.token || req.query.user_id).trim();
  }
  return null;
}

/* BACKWARD-COMPATIBLE resolver. Returns { userId, viaLegacy } or null.
   - signed token  -> { userId, viaLegacy:false }
   - legacy UUID   -> { userId, viaLegacy:true }   (still accepted)
   Stage 5 (much later) will drop the legacy branch once all live
   sessions have cycled to signed tokens. */
function resolveUser(req) {
  const raw = extractToken(req);
  if (!raw) return null;
  const verified = verifySession(raw);
  if (verified) return { userId: verified.userId, viaLegacy: false };
  if (isUuid(raw)) return { userId: raw, viaLegacy: true };
  return null;
}

module.exports = { signSession, verifySession, resolveUser, extractToken, isUuid };
`;

fs.writeFileSync(file, body, 'utf8');

try {
  execSync('node --check "' + file + '"', { stdio: 'pipe' });
  ok('api/_auth.js created, JS valid');
} catch (e) {
  errExit('_auth.js JS error: ' + e.stderr.toString());
}

log('');
log('==============================================================');
log('Patch 38 Stage 1 complete \u2014 ZERO risk (new file only).');
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 38 Stage 1: auth foundation helper"');
log('  git push');
log('');
log('IMPORTANT \u2014 set the JWT_SECRET env var now (needed from Stage 2):');
log('  1. Generate a long random string. In PowerShell you can run:');
log('     -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | %{[char]$_})');
log('  2. Vercel -> your project -> Settings -> Environment Variables');
log('  3. Add: name JWT_SECRET, value = that random string, all environments');
log('  4. Redeploy (or it applies on next deploy).');
log('');
log('Nothing about the live site changes in this stage. api/_auth.js is');
log('not imported by any endpoint yet \u2014 it just exists, ready for Stage 2');
log('(login issues signed tokens) and Stage 4 (sensitive endpoints adopt');
log('the backward-compatible resolveUser check).');
log('');
log('Test: there is nothing user-facing to test. Confirm the deploy');
log('succeeded and the site works exactly as before (it will \u2014 no');
log('existing file was touched).');
log('==============================================================');
