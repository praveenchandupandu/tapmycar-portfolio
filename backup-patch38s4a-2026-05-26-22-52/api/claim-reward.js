const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// TMC_PATCH2_ORIGIN_GUARD
function checkOrigin(req) {
  const origin = req.headers.origin;
  // Missing origin = same-origin or server-to-server, allowed
  if (!origin) return true;
  // Allowlist: tapmycar.io domains and any *.vercel.app preview
  if (origin === 'https://tapmycar.io') return true;
  if (origin === 'https://www.tapmycar.io') return true;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}


module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden origin' });

  const { user_id, choice } = req.body;
  if (!user_id || !choice) return res.status(400).json({ error: "user_id and choice required" });

  const { data: user } = await supabase.from("users").select("*").eq("id", user_id).single();
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.referral_reward_pending !== "choice") return res.status(400).json({ error: "No pending reward" });

  if (choice === "coupon") {
    // Create $4.99 Stripe coupon
    const coupon = await stripe.coupons.create({
      amount_off: 499,
      currency: "usd",
      duration: "once",
      name: "TapMyCar Referral Reward"
    });
    await supabase.from("users").update({ referral_reward_pending: null, referral_credits: 4.99 }).eq("id", user_id);
    return res.json({ success: true, type: "coupon", coupon_id: coupon.id });
  }

  if (choice === "free_standard") {
    // Give free standard - set credits to 9.99 to cover full price
    await supabase.from("users").update({ referral_reward_pending: null, referral_credits: 9.99 }).eq("id", user_id);
    return res.json({ success: true, type: "free_standard" });
  }

  return res.status(400).json({ error: "Invalid choice" });
};
