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

      // Get shipping details from Stripe session
      const fullSession = await stripe.checkout.sessions.retrieve(session.id, { expand: ['shipping_details'] });
      const ship = fullSession.shipping_details || null;

      await supabase.from("orders").insert({
        user_id, plan: plan || "etag",
        amount: session.amount_total,
        stripe_id: session.id,
        status: "paid",
        shipping_name: ship ? ship.name : null,
        shipping_address: ship ? ship.address.line1 + (ship.address.line2 ? ' ' + ship.address.line2 : '') : null,
        shipping_city: ship ? ship.address.city : null,
        shipping_state: ship ? ship.address.state : null,
        shipping_zip: ship ? ship.address.postal_code : null,
        shipping_fee: 100,
        order_status: (plan === 'standard' || plan === 'premium' || plan === 'business') ? 'processing' : null
      });

      await supabase.from("tags").update({
        status: "active",
        activated_at: new Date().toISOString(),
        plan: plan || "etag"
      }).eq("owner_id", user_id);

      await supabase.from("users").update({ plan: plan || "etag" }).eq("id", user_id);

      // Send order confirmation emails
      const { data: orderUser } = await supabase.from("users").select("*").eq("id", user_id).single();
      const { data: newOrder } = await supabase.from("orders").select("*").eq("stripe_id", session.id).single();
      if (orderUser && newOrder) {
        const planNames = { etag: "eTag", standard: "Standard", premium: "Premium", business: "Business" };
        const planName = planNames[plan] || plan;
        const shipInfo = newOrder.shipping_address ? newOrder.shipping_name + ", " + newOrder.shipping_address + ", " + newOrder.shipping_city + ", " + newOrder.shipping_state + " " + newOrder.shipping_zip : null;

        // Email to user
        if (orderUser.email) {
          await resend.emails.send({
            from: "TapMyCar <noreply@tapmycar.io>",
            to: orderUser.email,
            subject: "Order confirmed � TapMyCar " + planName + " Plan",
            html: '<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">' +
              '<div style="font-size:24px;font-weight:800;color:#111;margin-bottom:4px">TapMyCar<span style="color:#FF6B00">.</span></div>' +
              '<div style="font-size:13px;color:#6B7280;margin-bottom:24px">Privacy for you. Safety for your car.</div>' +
              '<div style="font-size:20px;font-weight:800;color:#111;margin-bottom:16px">Order Confirmed!</div>' +
              '<div style="background:#DCFCE7;border:1.5px solid #BBF7D0;border-radius:14px;padding:16px;margin-bottom:16px">' +
              '<div style="font-size:13px;font-weight:700;color:#166534;margin-bottom:8px">What you ordered</div>' +
              '<div style="font-size:13px;color:#166534">Plan: ' + planName + '</div>' +
              '<div style="font-size:13px;color:#166534">Amount: 

      // Referral reward logic - only for paid plans (not etag)
      if (plan === "standard" || plan === "premium") {
        const { data: buyer } = await supabase.from("users").select("referred_by").eq("id", user_id).single();
        if (buyer && buyer.referred_by) {
          const { data: referrer } = await supabase.from("users").select("id, referral_count, referral_credits, referral_reward_pending").eq("referral_code", buyer.referred_by).single();
          if (referrer) {
            const newCount = (referrer.referral_count || 0) + 1;
            let updates = { referral_count: newCount };
            if (newCount === 1) {
              // First referral - $3 discount credit
              updates.referral_credits = (referrer.referral_credits || 0) + 3.00;
            } else {
              // 2nd+ referral - choice reward
              updates.referral_reward_pending = "choice";
            }
            await supabase.from("users").update(updates).eq("id", referrer.id);
          }
        }
      }

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
 + (session.amount_total / 100).toFixed(2) + '</div>' +
              (shipInfo ? '<div style="font-size:13px;color:#166534;margin-top:4px">Ships to: ' + shipInfo + '</div>' : '') +
              '</div>' +
              (shipInfo ? '<div style="background:#FFF3EC;border:1.5px solid #FFE4CC;border-radius:14px;padding:16px;margin-bottom:16px">' +
              '<div style="font-size:13px;font-weight:700;color:#FF6B00;margin-bottom:4px">Your physical sticker</div>' +
              '<div style="font-size:12px;color:#92400E">We are preparing your NFC + QR sticker. You will receive a shipping confirmation once it is on its way. We deliver safely and fast!</div>' +
              '</div>' : '') +
              '<a href="https://tapmycar.io/dashboard.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">Go to Dashboard</a>' +
              '</div>'
          });
        }

        // Email to admin
        await resend.emails.send({
          from: "TapMyCar <noreply@tapmycar.io>",
          to: "support@tapmycar.io",
          subject: "NEW ORDER - " + planName + " - " + (orderUser.name || "Unknown"),
          html: '<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">' +
            '<div style="font-size:20px;font-weight:800;color:#111;margin-bottom:16px">New Order Received!</div>' +
            '<div style="background:#F9FAFB;border-radius:14px;padding:16px;margin-bottom:16px">' +
            '<div style="font-size:13px;margin-bottom:6px"><b>Customer:</b> ' + (orderUser.name || "Unknown") + '</div>' +
            '<div style="font-size:13px;margin-bottom:6px"><b>Email:</b> ' + (orderUser.email || "N/A") + '</div>' +
            '<div style="font-size:13px;margin-bottom:6px"><b>Phone:</b> ' + (orderUser.phone || "N/A") + '</div>' +
            '<div style="font-size:13px;margin-bottom:6px"><b>Plan:</b> ' + planName + '</div>' +
            '<div style="font-size:13px;margin-bottom:6px"><b>Amount:</b> 

      // Referral reward logic - only for paid plans (not etag)
      if (plan === "standard" || plan === "premium") {
        const { data: buyer } = await supabase.from("users").select("referred_by").eq("id", user_id).single();
        if (buyer && buyer.referred_by) {
          const { data: referrer } = await supabase.from("users").select("id, referral_count, referral_credits, referral_reward_pending").eq("referral_code", buyer.referred_by).single();
          if (referrer) {
            const newCount = (referrer.referral_count || 0) + 1;
            let updates = { referral_count: newCount };
            if (newCount === 1) {
              // First referral - $3 discount credit
              updates.referral_credits = (referrer.referral_credits || 0) + 3.00;
            } else {
              // 2nd+ referral - choice reward
              updates.referral_reward_pending = "choice";
            }
            await supabase.from("users").update(updates).eq("id", referrer.id);
          }
        }
      }

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
 + (session.amount_total / 100).toFixed(2) + '</div>' +
            (shipInfo ? '<div style="font-size:13px;margin-bottom:6px"><b>Ship to:</b> ' + shipInfo + '</div>' : '<div style="font-size:13px;color:#6B7280">No physical shipping needed</div>') +
            '</div>' +
            (shipInfo ? '<div style="background:#FFF3EC;border-radius:14px;padding:14px;font-size:13px;color:#FF6B00;font-weight:700">Action required: Pack and ship the NFC sticker!</div>' : '') +
            '</div>'
        });
      }

      // Referral reward logic - only for paid plans (not etag)
      if (plan === "standard" || plan === "premium") {
        const { data: buyer } = await supabase.from("users").select("referred_by").eq("id", user_id).single();
        if (buyer && buyer.referred_by) {
          const { data: referrer } = await supabase.from("users").select("id, referral_count, referral_credits, referral_reward_pending").eq("referral_code", buyer.referred_by).single();
          if (referrer) {
            const newCount = (referrer.referral_count || 0) + 1;
            let updates = { referral_count: newCount };
            if (newCount === 1) {
              // First referral - $3 discount credit
              updates.referral_credits = (referrer.referral_credits || 0) + 3.00;
            } else {
              // 2nd+ referral - choice reward
              updates.referral_reward_pending = "choice";
            }
            await supabase.from("users").update(updates).eq("id", referrer.id);
          }
        }
      }

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
