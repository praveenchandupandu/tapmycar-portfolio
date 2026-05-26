const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: "user_id required" });

  const { data: user } = await supabase.from("users").select("referral_code, referral_count, referral_credits, referral_reward_pending").eq("id", user_id).single();
  if (!user) return res.status(404).json({ error: "User not found" });

  return res.json({ success: true, ...user });
};
