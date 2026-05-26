// TMC_PATCH38_AUTH_FOUNDATION
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
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

/* TMC_PATCH38S4: pull the caller's auth identifier from a request.
   - signed token   -> Authorization: Bearer <token> (set by the
     Stage 3 fetch wrapper in app.js)
   - legacy raw UUID -> the explicit `user_id` field (body or query)
   We deliberately do NOT read a generic `token` field: in this
   codebase `token` is overloaded (tag tokens, etc.), so using it for
   auth would mis-resolve the caller. */
function extractToken(req) {
  const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  if (req.body && req.body.user_id) return String(req.body.user_id).trim();
  if (req.query && req.query.user_id) return String(req.query.user_id).trim();
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

/* TMC_PATCH38S4: record which token type a user's request used so the
   admin panel can show migration progress (legacy -> signed). Takes
   the caller's own supabase client; never throws, never blocks the
   request on a stats failure. Needs users.last_token_type /
   last_token_at (see patch38s4-migration.sql). */
async function recordTokenType(supabase, userId, viaLegacy) {
  try {
    if (!supabase || !userId) return;
    await supabase.from('users').update({
      last_token_type: viaLegacy ? 'legacy' : 'signed',
      last_token_at: new Date().toISOString()
    }).eq('id', userId);
  } catch (e) {
    /* non-fatal — a stats write must never break a real request */
  }
}

module.exports = { signSession, verifySession, resolveUser, extractToken, isUuid, recordTokenType };
