const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { user_id, endpoint, p256dh, auth } = req.body;
  if (!user_id || !endpoint || !p256dh || !auth) return res.status(400).json({ error: "Missing fields" });
  await supabase.from("push_subscriptions").upsert({ user_id, endpoint, p256dh, auth }, { onConflict: "endpoint" });
  return res.json({ success: true });
};
