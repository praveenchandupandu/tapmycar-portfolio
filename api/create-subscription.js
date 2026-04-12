const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const PRICE_IDS = {
  standard: "price_1TLTIBISVGiuIvF5ACnfAb4t",
  premium: "price_1TLTJ9ISVGiuIvF5A1xMjZgq"
};

const AMOUNTS = {
  etag_upgrade: 999,
  standard: 999,
  premium: 2499
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { user_id, plan } = req.body;
  if (!user_id || !plan) return res.status(400).json({ error: "user_id and plan required" });

  const { data: user } = await supabase.from("users").select("*").eq("id", user_id).single();
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!user.stripe_customer_id) return res.status(400).json({ error: "No payment method on file" });

  try {
    // Get saved payment method
    const paymentMethods = await stripe.paymentMethods.list({
      customer: user.stripe_customer_id,
      type: "card"
    });

    if (!paymentMethods.data.length) {
      return res.status(400).json({ error: "No saved payment method found" });
    }

    const priceId = PRICE_IDS[plan] || PRICE_IDS.standard;

    // Create subscription with 30-day trial
    const subscription = await stripe.subscriptions.create({
      customer: user.stripe_customer_id,
      items: [{ price: priceId }],
      default_payment_method: paymentMethods.data[0].id,
      trial_end: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
      metadata: { user_id, plan }
    });

    // Save subscription ID
    await supabase.from("users").update({ subscription_id: subscription.id }).eq("id", user_id);
    await supabase.from("orders").update({ subscription_id: subscription.id }).eq("user_id", user_id).eq("status", "paid");

    return res.json({ success: true, subscription_id: subscription.id });
  } catch (err) {
    console.error("Subscription error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
