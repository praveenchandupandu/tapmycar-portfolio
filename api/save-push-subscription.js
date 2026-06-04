// TMC_PATCH42_PUSHSUB - surfaces real DB errors instead of masking them,
// and marks the user as push_subscribed on a successful save.
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
/* TMC_PATCH68 */ const { resolveUser } = require("./_auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  /* TMC_PATCH68: identity from signed session token, not the body. */
  const _p68authed = resolveUser(req);
  if (!_p68authed) return res.status(401).json({ error: "Sign in required" });
  const user_id = _p68authed.userId;
  const { endpoint, p256dh, auth } = req.body || {};
  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: "Missing fields" });
  }

  // Write the subscription. onConflict:"endpoint" requires the UNIQUE
  // constraint on push_subscriptions.endpoint (created in Stage 1).
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert({ user_id, endpoint, p256dh, auth }, { onConflict: "endpoint" });

  if (error) {
    console.error("save-push-subscription error:", error.message);
    return res.status(500).json({ error: error.message });
  }

  // Best-effort: flag the user as push-subscribed. Non-fatal if it fails.
  try {
    await supabase.from("users").update({ push_subscribed: true }).eq("id", user_id);
  } catch (e) {
    console.error("push_subscribed flag update failed:", e && e.message);
  }

  return res.json({ success: true });
};
