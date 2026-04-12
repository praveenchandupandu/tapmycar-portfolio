const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id required" });

  const { data: user } = await supabase.from("users").select("*").eq("id", user_id).single();
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!user.subscription_id) return res.status(400).json({ error: "No active subscription" });

  try {
    await stripe.subscriptions.cancel(user.subscription_id);
    await supabase.from("users").update({ subscription_id: null }).eq("id", user_id);
    return res.json({ success: true });
  } catch (err) {
    console.error("Cancel subscription error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
