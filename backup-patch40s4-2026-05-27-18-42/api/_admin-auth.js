// TMC_PATCH40_ADMIN_AUTH
// Shared admin-auth helper for TapMyCar. Signs a short admin session
// token with HMAC-SHA256 (Node built-in crypto — no dependency), the same
// approach as _auth.js. The token is delivered to the browser as an
// httpOnly cookie, so page JavaScript cannot read it (no localStorage /
// sessionStorage exposure, immune to XSS theft).
//
// resolveAdmin(req) is BACKWARD-COMPATIBLE: it returns true for a valid
// httpOnly cookie OR for any of the legacy admin-key styles the existing
// endpoints use today. That lets Stage 3 migrate every endpoint with no
// lockout. Stage 4 (later) drops the legacy styles.

const crypto = require('crypto');

/* The cookie is SIGNED with JWT_SECRET (already set in Vercel for Patch 38).
   ADMIN_SECRET_KEY remains the value typed at login; it is NOT the signing
   secret. */
const SECRET = process.env.JWT_SECRET || '';
const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || '';

/* admin session lifetime: 12 hours (admins re-auth more often than users) */
const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;
const COOKIE_NAME = 'tmc_admin_session';

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

/* Create a signed admin session token. */
function signAdminSession() {
  if (!SECRET) throw new Error('JWT_SECRET not set');
  const now = Date.now();
  const payload = { adm: true, iat: now, exp: now + ADMIN_TTL_MS };
  const payloadStr = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(payloadStr).digest());
  return payloadStr + '.' + sig;
}

/* Verify a signed admin token. Returns true if valid + unexpired. */
function verifyAdminSession(token) {
  try {
    if (!SECRET || typeof token !== 'string' || token.indexOf('.') === -1) return false;
    const parts = token.split('.');
    const payloadStr = parts[0], sig = parts[1];
    if (!payloadStr || !sig) return false;
    const expected = b64url(crypto.createHmac('sha256', SECRET).update(payloadStr).digest());
    if (sig.length !== expected.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const payload = JSON.parse(b64urlDecode(payloadStr));
    if (!payload || payload.adm !== true) return false;
    if (payload.exp && Date.now() > payload.exp) return false;
    return true;
  } catch (e) {
    return false;
  }
}

/* Build the Set-Cookie value for a fresh admin session.
   HttpOnly  -> JavaScript cannot read it
   Secure    -> only sent over https (tapmycar.io is https)
   SameSite=Strict -> not sent on cross-site requests
   Path=/    -> sent to every /api/* route */
function adminCookie(token) {
  const maxAge = Math.floor(ADMIN_TTL_MS / 1000);
  return COOKIE_NAME + '=' + token +
    '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + maxAge;
}

/* Build the Set-Cookie value that expires the cookie immediately (logout). */
function clearAdminCookie() {
  return COOKIE_NAME + '=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
}

/* Read a single cookie value from a request's Cookie header. */
function readCookie(req, name) {
  try {
    const header = req.headers && req.headers.cookie;
    if (!header) return null;
    const parts = header.split(';');
    for (let i = 0; i < parts.length; i++) {
      const eq = parts[i].indexOf('=');
      if (eq === -1) continue;
      const k = parts[i].slice(0, eq).trim();
      if (k === name) return parts[i].slice(eq + 1).trim();
    }
    return null;
  } catch (e) {
    return null;
  }
}

/* Pull a legacy raw admin key from a request, covering every style the
   existing 15 admin endpoints use: x-admin-key header, ?admin=,
   ?admin_key=, ?key=, body.admin_key, body.admin. */
function legacyAdminKey(req) {
  const h = req.headers || {};
  const q = req.query || {};
  const b = req.body || {};
  return h['x-admin-key'] || q.admin || q.admin_key || q.key ||
         b.admin_key || b.admin || null;
}

/* BACKWARD-COMPATIBLE admin check. Returns true if the request carries a
   valid httpOnly admin cookie OR a correct legacy raw key. Stage 3 points
   every admin endpoint at this; Stage 4 later drops the legacy branch. */
function resolveAdmin(req) {
  /* 1) preferred: signed httpOnly cookie */
  const cookieTok = readCookie(req, COOKIE_NAME);
  if (cookieTok && verifyAdminSession(cookieTok)) return true;
  /* 2) legacy: a correct raw admin key (constant-time compared) */
  const raw = legacyAdminKey(req);
  if (raw && ADMIN_KEY) {
    const a = Buffer.from(String(raw));
    const b = Buffer.from(String(ADMIN_KEY));
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

module.exports = {
  signAdminSession, verifyAdminSession,
  adminCookie, clearAdminCookie, readCookie,
  resolveAdmin, legacyAdminKey,
  COOKIE_NAME
};
