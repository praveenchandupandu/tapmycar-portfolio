const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { user_id, plan, address } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id required" });

  const { data: user } = await supabase.from("users").select("*").eq("id", user_id).single();
  if (!user) return res.status(404).json({ error: "User not found" });

  const PRICES = { etag: 100, standard: 999, premium: 2499, business: 4900 };
  const NAMES = { etag: "TapMyCar eTag Activation", standard: "TapMyCar Standard Plan", premium: "TapMyCar Premium Plan", business: "TapMyCar Business Plan" };
  const amount = PRICES[plan] || 100;
  const name = NAMES[plan] || "TapMyCar Plan";

  try {
    // Create or get Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        name: user.name || undefined,
        metadata: { user_id }
      });
      customerId = customer.id;
      await supabase.from("users").update({ stripe_customer_id: customerId }).eq("id", user_id);
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer: customerId,
      payment_intent_data: {
        setup_future_usage: "off_session",
        metadata: { user_id, plan }
      },
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name, description: plan === "etag" ? "Digital QR tag + upgrade to Standard after 30 days" : "Physical NFC + QR sticker ships to your address" },
          unit_amount: amount
        },
        quantity: 1
      }],
      metadata: { user_id, plan, address: address || "" },
      success_url: `${req.headers.origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/activate.html`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
