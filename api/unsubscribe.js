// TMC_PATCH42_UNSUBSCRIBE - public email unsubscribe / resubscribe endpoint.
// POST { user_id, token, action }. Token must equal users.unsubscribe_token.
// action "resubscribe" clears the opt-out; anything else sets it.
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { user_id, token, action } = req.body || {};
  if (!user_id || !token) return res.status(400).json({ error: "Missing user_id or token" });

  const { data: user, error } = await supabase
    .from("users")
    .select("id, email, unsubscribe_token, email_opt_out")
    .eq("id", user_id)
    .single();

  if (error || !user) return res.status(404).json({ error: "Not found" });
  if (!user.unsubscribe_token || user.unsubscribe_token !== token) {
    return res.status(403).json({ error: "Invalid unsubscribe link" });
  }

  // Default action = unsubscribe (opt OUT). "resubscribe" opts back in.
  const optOut = action !== "resubscribe";

  const { error: upErr } = await supabase
    .from("users")
    .update({ email_opt_out: optOut })
    .eq("id", user_id);
  if (upErr) {
    console.error("unsubscribe update error:", upErr.message);
    return res.status(500).json({ error: upErr.message });
  }

  // Audit the preference change. Non-fatal if logging fails.
  try {
    await supabase.from("notifications_log").insert({
      channel: "email",
      event_type: "system",
      recipient_user_id: user_id,
      recipient_contact: user.email || null,
      subject: optOut ? "Email unsubscribe" : "Email resubscribe",
      body_preview: optOut
        ? "User opted out of marketing emails"
        : "User opted back in to marketing emails",
      sent_by: "system",
      status: "sent"
    });
  } catch (e) {
    console.error("notifications_log insert failed:", e && e.message);
  }

  return res.json({ success: true, email_opt_out: optOut });
};
