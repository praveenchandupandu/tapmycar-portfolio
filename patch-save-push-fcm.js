#!/usr/bin/env node
/**
 * TMC_PATCH_FCM_SAVESUB
 *
 * Updates api/save-push-subscription.js to ALSO accept the FCM (mobile)
 * token format, in addition to the existing web push format. Both paths
 * remain authenticated via resolveUser (signed session token).
 *
 * Request body now accepted:
 *
 *   Web push (existing):
 *     { endpoint, p256dh, auth }
 *
 *   FCM mobile (new):
 *     { fcm_token, platform }      // platform = 'android' | 'ios'
 *
 * Routing: presence of fcm_token triggers the FCM path, otherwise we
 * use the web push path. Either path will succeed, but a request must
 * contain ONE complete set, not a mix.
 *
 * Idempotent — detects existing TMC_PATCH_FCM_SAVESUB marker.
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-save-push-fcm-' + stamp;

console.log('\n=== TMC_PATCH_FCM_SAVESUB - Extend save-push-subscription for FCM ===\n');

const target = path.join('api', 'save-push-subscription.js');
if (!fs.existsSync(target)) {
  console.error('  X ' + target + ' not found');
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });
fs.copyFileSync(target, path.join(backupDir, path.basename(target)));

let src = fs.readFileSync(target, 'utf8');

if (src.indexOf('TMC_PATCH_FCM_SAVESUB') !== -1) {
  console.log('  ~ Already patched - skipping');
  process.exit(0);
}

// New file content. We replace the entire file because the routing
// logic is centralized and surgical edits would be fragile.
const newSrc = `// TMC_PATCH42_PUSHSUB - surfaces real DB errors instead of masking them,
// and marks the user as push_subscribed on a successful save.
// TMC_PATCH_FCM_SAVESUB - also accepts FCM mobile tokens in addition to web push.
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
/* TMC_PATCH68 */ const { resolveUser } = require("./_auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  /* TMC_PATCH68: identity from signed session token, not the body. */
  const _p68authed = resolveUser(req);
  if (!_p68authed) return res.status(401).json({ error: "Sign in required" });
  const user_id = _p68authed.userId;

  const body = req.body || {};
  const { endpoint, p256dh, auth, fcm_token, platform } = body;

  /* TMC_PATCH_FCM_SAVESUB: route based on which token format is present.
     fcm_token wins if present (mobile app sends only this), otherwise we
     fall back to the legacy web push fields. */

  // ---- FCM MOBILE PATH ---------------------------------------------------
  if (fcm_token) {
    const plat = String(platform || '').toLowerCase();
    if (plat !== 'android' && plat !== 'ios') {
      return res.status(400).json({ error: "platform must be 'android' or 'ios'" });
    }

    /* Upsert by fcm_token (we have a partial unique index on that column).
       This means if the same device re-registers (e.g., user signs out
       and back in), we update the existing row instead of creating a
       duplicate. */
    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        { user_id, fcm_token, platform: plat },
        { onConflict: "fcm_token" }
      );
    if (error) {
      console.error("save-push-subscription (fcm) error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    // Best-effort: flag the user as push-subscribed.
    try {
      await supabase.from("users").update({ push_subscribed: true }).eq("id", user_id);
    } catch (e) {
      console.error("push_subscribed flag update failed:", e && e.message);
    }

    return res.json({ success: true, kind: 'fcm' });
  }

  // ---- WEB PUSH PATH (LEGACY) -------------------------------------------
  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: "Missing fields" });
  }
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert({ user_id, endpoint, p256dh, auth, platform: 'web' }, { onConflict: "endpoint" });
  if (error) {
    console.error("save-push-subscription error:", error.message);
    return res.status(500).json({ error: error.message });
  }
  try {
    await supabase.from("users").update({ push_subscribed: true }).eq("id", user_id);
  } catch (e) {
    console.error("push_subscribed flag update failed:", e && e.message);
  }
  return res.json({ success: true, kind: 'web' });
};
`;

fs.writeFileSync(target, newSrc, 'utf8');
console.log('  + api/save-push-subscription.js: extended for FCM mobile path');
console.log('');
console.log('  Backup: ' + backupDir + '/');
console.log('');
console.log('Next:');
console.log('  node --check api/save-push-subscription.js');
console.log('  git add api/save-push-subscription.js');
console.log('  git commit -m "Phase 3: save-push-subscription accepts FCM mobile tokens"');
console.log('  git push');
console.log('');
