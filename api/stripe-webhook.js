const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(400).json({ error: err.message });
  }

  switch (event.type) {

    case "checkout.session.completed": {
      const session = event.data.object;
      const { user_id, plan, address } = session.metadata;

      await supabase.from("orders").insert({
        user_id, plan: plan || "etag",
        amount: session.amount_total,
        stripe_id: session.id,
        status: "paid"
      });

      await supabase.from("tags").update({
        status: "active",
        activated_at: new Date().toISOString(),
        plan: plan || "etag"
      }).eq("owner_id", user_id);

      await supabase.from("users").update({ plan: plan || "etag" }).eq("id", user_id);

      // Auto-start subscription after 30 days for standard/premium
      if (plan === "standard" || plan === "premium") {
        const { data: user } = await supabase.from("users").select("*").eq("id", user_id).single();
        if (user && user.stripe_customer_id) {
          const PRICE_IDS = {
            standard: "price_1TLTIBISVGiuIvF5ACnfAb4t",
            premium: "price_1TLTJ9ISVGiuIvF5A1xMjZgq"
          };
          const paymentMethods = await stripe.paymentMethods.list({
            customer: user.stripe_customer_id, type: "card"
          });
          if (paymentMethods.data.length) {
            const subscription = await stripe.subscriptions.create({
              customer: user.stripe_customer_id,
              items: [{ price: PRICE_IDS[plan] }],
              default_payment_method: paymentMethods.data[0].id,
              trial_end: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
              metadata: { user_id, plan }
            });
            await supabase.from("users").update({ subscription_id: subscription.id }).eq("id", user_id);
          }
        }
      }
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const { data: user } = await supabase.from("users").select("*").eq("stripe_customer_id", customerId).single();
      if (user) {
        await supabase.from("tags").update({ status: "active" }).eq("owner_id", user.id);
        if (user.email) {
          await resend.emails.send({
            from: "TapMyCar <noreply@tapmycar.io>",
            to: user.email,
            subject: "Your TapMyCar subscription has been renewed",
            html: `<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
              <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
              <div style="font-size:14px;color:#6B7280;margin-bottom:24px">Privacy for you. Safety for your car.</div>
              <div style="background:#DCFCE7;border:1.5px solid #BBF7D0;border-radius:14px;padding:16px;margin-bottom:20px">
                <div style="font-size:14px;font-weight:700;color:#166534;margin-bottom:4px">Subscription Renewed</div>
                <div style="font-size:12px;color:#15803D">Your TapMyCar tag is active for another year. Thank you!</div>
              </div>
              <a href="https://tapmycar.io/dashboard.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">View Dashboard</a>
            </div>`
          });
        }
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const { data: user } = await supabase.from("users").select("*").eq("stripe_customer_id", customerId).single();
      if (user && user.email) {
        await resend.emails.send({
          from: "TapMyCar <noreply@tapmycar.io>",
          to: user.email,
          subject: "Action required - TapMyCar payment failed",
          html: `<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
            <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
            <div style="background:#FEE2E2;border:1.5px solid #FECACA;border-radius:14px;padding:16px;margin-bottom:20px">
              <div style="font-size:14px;font-weight:700;color:#DC2626;margin-bottom:4px">Payment Failed</div>
              <div style="font-size:12px;color:#B91C1C">We could not process your renewal payment. Please update your payment method to keep your tag active.</div>
            </div>
            <a href="https://tapmycar.io/settings.html" style="display:block;background:#DC2626;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">Update Payment Method</a>
          </div>`
        });
      }
      break;
    }

    case "invoice.upcoming": {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const amount = (invoice.amount_due / 100).toFixed(2);
      const dueDate = new Date(invoice.period_end * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      const { data: user } = await supabase.from("users").select("*").eq("stripe_customer_id", customerId).single();
      if (user && user.email) {
        await resend.emails.send({
          from: "TapMyCar <noreply@tapmycar.io>",
          to: user.email,
          subject: "Your TapMyCar renewal is coming up",
          html: `<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
            <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
            <div style="background:#FFF3EC;border:1.5px solid #FFE4CC;border-radius:14px;padding:16px;margin-bottom:20px">
              <div style="font-size:14px;font-weight:700;color:#FF6B00;margin-bottom:4px">Renewal Reminder</div>
              <div style="font-size:12px;color:#92400E">Your TapMyCar subscription renews on ${dueDate} for $${amount}. No action needed if you want to continue.</div>
            </div>
            <a href="https://tapmycar.io/settings.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">Manage Subscription</a>
          </div>`
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      const { data: user } = await supabase.from("users").select("*").eq("stripe_customer_id", customerId).single();
      if (user) {
        await supabase.from("tags").update({ status: "disabled" }).eq("owner_id", user.id);
        await supabase.from("users").update({ plan: "free", subscription_id: null }).eq("id", user.id);
        if (user.email) {
          await resend.emails.send({
            from: "TapMyCar <noreply@tapmycar.io>",
            to: user.email,
            subject: "Your TapMyCar subscription has been cancelled",
            html: `<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
              <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
              <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:14px;padding:16px;margin-bottom:20px">
                <div style="font-size:14px;font-weight:700;color:#111;margin-bottom:4px">Subscription Cancelled</div>
                <div style="font-size:12px;color:#6B7280">Your TapMyCar tag has been deactivated. Reactivate anytime at tapmycar.io</div>
              </div>
              <a href="https://tapmycar.io/pricing.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">Reactivate</a>
            </div>`
          });
        }
      }
      break;
    }
  }

  res.json({ received: true });
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
