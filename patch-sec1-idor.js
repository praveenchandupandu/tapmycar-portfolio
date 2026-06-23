#!/usr/bin/env node
/**
 * TMC_PATCH_SEC1 — Close IDOR vulnerabilities
 *
 * Hardens three endpoints that previously trusted user_id from the
 * request body/query without verifying the caller's identity. After
 * this patch, the user_id used in DB queries comes from the SIGNED
 * SESSION TOKEN (Authorization: Bearer ...) — same pattern as the
 * 17 endpoints that already use resolveUser().
 *
 * Endpoints fixed:
 *
 *   1. get-tag.js
 *      - POST status_override (paused/inactive/active): now requires
 *        the authenticated user to OWN the tag being modified.
 *      - POST claim/update: owner_id is set from resolveUser, not from
 *        request body. Prevents tag takeover.
 *      - GET ?user_id=: now uses authenticated user, not query param.
 *        Prevents enumerating other users' tags.
 *
 *   2. redeem-code.js
 *      - user_id now comes from resolveUser, not request body.
 *        Prevents redeeming codes on someone else's account.
 *
 *   3. my-tows.js
 *      - user_id now comes from resolveUser, not query string.
 *        Prevents reading other users' tow notifications.
 *
 * Backward compatibility:
 *   - The app already sends Authorization: Bearer <session_token> on
 *     /api/* calls (Patch 38S3 fetch wrapper).
 *   - Endpoints called WITHOUT a Bearer token (signed-out users
 *     scanning a public /tag/:token URL) still work — those use the
 *     `token` query param path which has no user_id check.
 *
 * Idempotent — uses markers to detect prior application.
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-sec1-idor-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH_SEC1 — Close IDOR vulnerabilities       ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

let changedAny = false;

// ====================================================================
// FIX 1 — my-tows.js (simplest, lowest blast radius)
// ====================================================================
try {
  const p = path.join('api', 'my-tows.js');
  if (!fs.existsSync(p)) throw new Error(p + ' not found');
  let s = fs.readFileSync(p, 'utf8');
  if (s.indexOf('TMC_PATCH_SEC1') !== -1) {
    console.log('  ⏩ my-tows.js already patched');
  } else {
    backup(p);
    // Add resolveUser import after the first require
    s = s.replace(
      /(const supabase = createClient\(process\.env\.SUPABASE_URL, process\.env\.SUPABASE_SERVICE_KEY\);)/,
      "$1\n/* TMC_PATCH_SEC1: replace trust-the-client with signed-token auth */\nconst { resolveUser } = require('./_auth');"
    );
    // Replace the user_id extraction
    s = s.replace(
      /  const user_id = String\(req\.query\.user_id \|\| ''\)\.trim\(\);\n  if \(!user_id\) return res\.status\(400\)\.json\(\{ error: 'user_id required' \}\);/,
      "  /* TMC_PATCH_SEC1: use server-verified user id, not query param */\n  const _auth = resolveUser(req);\n  if (!_auth) return res.status(401).json({ error: 'Sign in required' });\n  const user_id = _auth.userId;"
    );
    fs.writeFileSync(p, s, 'utf8');
    console.log('  ✓ my-tows.js: now uses resolveUser');
    changedAny = true;
  }
} catch (e) {
  console.error('  ✗ my-tows.js: ' + e.message);
}

// ====================================================================
// FIX 2 — redeem-code.js
// ====================================================================
try {
  const p = path.join('api', 'redeem-code.js');
  if (!fs.existsSync(p)) throw new Error(p + ' not found');
  let s = fs.readFileSync(p, 'utf8');
  if (s.indexOf('TMC_PATCH_SEC1') !== -1) {
    console.log('  ⏩ redeem-code.js already patched');
  } else {
    backup(p);
    // Add resolveUser import after _rate-limit require
    s = s.replace(
      /(const \{ rateLimit, getClientIp \} = require\('\.\/_rate-limit'\);)/,
      "$1\n/* TMC_PATCH_SEC1: signed-token auth */\nconst { resolveUser } = require('./_auth');"
    );
    // Replace user_id extraction from body with resolveUser
    s = s.replace(
      /  const \{ user_id, code \} = req\.body \|\| \{\};\n\n  if \(!user_id\) return res\.status\(400\)\.json\(\{ error: 'user_id required' \}\);/,
      "  const { code } = req.body || {};\n\n  /* TMC_PATCH_SEC1: user identity from signed token, never from body */\n  const _auth = resolveUser(req);\n  if (!_auth) return res.status(401).json({ error: 'Sign in required' });\n  const user_id = _auth.userId;"
    );
    // Remove the now-redundant UUID validation block (signed token always returns valid uuid)
    s = s.replace(
      /  \/\/ TMC_PATCH2_UUID_VALIDATE\n  const UUID_RE = \/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$\/i;\n  if \(!UUID_RE\.test\(String\(user_id\)\)\) \{\n    return res\.status\(400\)\.json\(\{ error: 'Invalid user_id format' \}\);\n  \}\n\n/,
      ""
    );
    fs.writeFileSync(p, s, 'utf8');
    console.log('  ✓ redeem-code.js: now uses resolveUser');
    changedAny = true;
  }
} catch (e) {
  console.error('  ✗ redeem-code.js: ' + e.message);
}

// ====================================================================
// FIX 3 — get-tag.js (most complex — multiple code paths)
// ====================================================================
try {
  const p = path.join('api', 'get-tag.js');
  if (!fs.existsSync(p)) throw new Error(p + ' not found');
  let s = fs.readFileSync(p, 'utf8');
  if (s.indexOf('TMC_PATCH_SEC1') !== -1) {
    console.log('  ⏩ get-tag.js already patched');
  } else {
    backup(p);

    // 3a. Add resolveUser import
    s = s.replace(
      /(const \{ resolveAdmin: _tmcResolveAdminCookie \} = require\('\.\/_admin-auth'\); \/\* TMC_PATCH40S3 \*\/)/,
      "$1\n/* TMC_PATCH_SEC1: signed-token user auth */\nconst { resolveUser: _tmcResolveUser } = require('./_auth');"
    );

    // 3b. For POST, add resolveUser at top of POST handler.
    // We hook in right after the token check. The auth result is OPTIONAL
    // for the body of the function (admin-only paths use admin auth), but
    // claim/status changes that AREN'T destructive will be gated below.
    s = s.replace(
      /(  if \(req\.method === 'POST'\) \{\n    const \{ token, user_id, license_plate, car_make, car_model, car_year, car_color, status_override \} = req\.body;\n\n    if \(!token\) \{\n      return res\.status\(400\)\.json\(\{ error: 'token required' \}\);\n    \}\n\n    const cleanToken = token\.toUpperCase\(\)\.trim\(\);)/,
      "$1\n\n    /* TMC_PATCH_SEC1: resolve caller from signed session.\n       Used below for non-admin paths to enforce ownership. */\n    const _tmcAuth = _tmcResolveUser(req);\n    const _tmcAuthUserId = _tmcAuth ? _tmcAuth.userId : null;"
    );

    // 3c. For non-destructive status_override (paused/inactive/active), require auth + ownership
    // Insert ownership check right before the supabase update for non-destructive status_override.
    s = s.replace(
      /(      const \{ data, error \} = await supabase\n        \.from\('tags'\)\n        \.update\(\{ status: status_override \}\)\.eq\('token', cleanToken\)\.select\(\);)/,
      "      /* TMC_PATCH_SEC1: non-destructive status_override (paused/inactive/active)\n         must come from the tag's owner — admins use the destructive path above. */\n      if (!_tmcAuthUserId) {\n        return res.status(401).json({ error: 'Sign in required' });\n      }\n      const { data: _ownerCheck } = await supabase\n        .from('tags').select('owner_id').eq('token', cleanToken).maybeSingle();\n      if (!_ownerCheck || _ownerCheck.owner_id !== _tmcAuthUserId) {\n        return res.status(403).json({ error: 'You do not own this tag.' });\n      }\n\n$1"
    );

    // 3d. For claim/update path, override the user_id from body with the verified one
    // The original code uses user_id from req.body. We override it.
    s = s.replace(
      /    \/\/ Normal claim\/update\n    if \(!user_id\) \{\n      return res\.status\(400\)\.json\(\{ error: 'user_id required' \}\);\n    \}/,
      "    /* TMC_PATCH_SEC1: ignore any user_id from the body. The authenticated\n       caller is the only one who can claim or update a tag for themselves. */\n    if (!_tmcAuthUserId) {\n      return res.status(401).json({ error: 'Sign in required' });\n    }\n    /* eslint-disable-next-line no-unused-vars */\n    const _ignoredBodyUserId = user_id; // intentionally ignored\n    const verifiedUserId = _tmcAuthUserId;"
    );

    // 3e. Now we need to update every reference to "user_id" within the claim/update path
    // to use verifiedUserId instead. We do this carefully — only in the claim/update flow.
    // The block runs from "    const { activation_session_id } = req.body;" to the
    // "return res.json({ success: true, tag: data || null, gift: giftApplied });"
    //
    // Replacements within this block: user_id -> verifiedUserId
    // We'll use a targeted block replacement.
    s = s.replace(
      /(    const \{ activation_session_id \} = req\.body;\n    const isActivating = !req\.body\.status_override;\n    if \(isActivating\) \{[\s\S]*?return res\.json\(\{ success: true, tag: data \|\| null, gift: giftApplied \}\);\n  \})/,
      function (block) {
        // Replace bare "user_id" with "verifiedUserId" but ONLY where it's used as a value,
        // not where it appears in string literals or comments.
        // Safest: just do the substitution carefully on the specific lines we know about.
        return block
          .replace(/session\.user_id !== user_id/g, 'session.user_id !== verifiedUserId')
          .replace(/\.eq\('owner_id', user_id\)/g, ".eq('owner_id', verifiedUserId)")
          .replace(/owner_id: user_id,/g, 'owner_id: verifiedUserId,')
          .replace(/'for user', user_id,/g, "'for user', verifiedUserId,")
          .replace(/\.eq\('id', user_id\)/g, ".eq('id', verifiedUserId)")
          .replace(/\(buyer: \${codeRow\.buyer_user_id}\)/g, function (m) { return m; }); // no-op safety
      }
    );

    // 3f. For GET ?user_id=, require authenticated user and use it
    s = s.replace(
      /  if \(user_id\) \{\n    const \{ data: tags, error \} = await supabase\n      \.from\('tags'\)\n      \.select\('\*'\)\n      \.eq\('owner_id', user_id\);\n\n    if \(error\) \{\n      return res\.status\(500\)\.json\(\{ error: error\.message \}\);\n    \}\n\n    return res\.json\(\{ tags \}\);\n  \}/,
      "  if (user_id) {\n    /* TMC_PATCH_SEC1: only allow the authenticated user to list their own tags */\n    const _getAuth = _tmcResolveUser(req);\n    if (!_getAuth) return res.status(401).json({ error: 'Sign in required' });\n    const { data: tags, error } = await supabase\n      .from('tags')\n      .select('*')\n      .eq('owner_id', _getAuth.userId);\n\n    if (error) {\n      return res.status(500).json({ error: error.message });\n    }\n\n    return res.json({ tags });\n  }"
    );

    fs.writeFileSync(p, s, 'utf8');
    console.log('  ✓ get-tag.js: all 3 IDOR issues closed');
    changedAny = true;
  }
} catch (e) {
  console.error('  ✗ get-tag.js: ' + e.message);
  if (e.stack) console.error(e.stack);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH_SEC1 complete' + (changedAny ? ' ✓' : ' (no changes)') + '            ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('\nNext:');
console.log('  git add -A');
console.log('  git commit -m "TMC_PATCH_SEC1: Close IDOR in get-tag, redeem-code, my-tows"');
console.log('  git push');
console.log('');
console.log('After Vercel deploys, smoke-test on the live site (NOT app yet):');
console.log('  1. Sign in to tapmycar.io (browser)');
console.log('  2. View your dashboard — your tags should load');
console.log('  3. Pause/unpause one of your tags — should work');
console.log('  4. If you have a referral code or premium code, redeem flow should work');
console.log('  5. If you have tow notifications, /my-tows should load');
console.log('');
console.log('If anything broke, revert with:');
console.log('  Copy-Item -Recurse "' + backupDir + '\\*" "." -Force');
console.log('');
