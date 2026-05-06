const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // TMC_PATCH1_ADMIN_CHECK
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { order_id, status, tracking_number } = req.body;
  if (!order_id || !status) return res.status(400).json({ error: "order_id and status required" });

  const updates = { order_status: status };
  if (tracking_number) updates.tracking_number = tracking_number;
  if (status === "shipped") updates.shipped_at = new Date().toISOString();

  await supabase.from("orders").update(updates).eq("id", order_id);

  // Send shipping notification to user
  if (status === "shipped") {
    const { data: order } = await supabase.from("orders").select("*, users(name, email)").eq("id", order_id).single();
    if (order && order.users && order.users.email) {
      await resend.emails.send({
        from: "TapMyCar <noreply@tapmycar.io>",
        to: order.users.email,
        subject: "Your TapMyCar sticker is on its way!",
        html: '<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">' +
          '<div style="font-size:24px;font-weight:800;color:#111;margin-bottom:4px">TapMyCar<span style="color:#FF6B00">.</span></div>' +
          '<div style="background:#DCFCE7;border:1.5px solid #BBF7D0;border-radius:14px;padding:16px;margin-bottom:16px">' +
          '<div style="font-size:16px;font-weight:800;color:#166534;margin-bottom:6px">Your sticker is shipped!</div>' +
          '<div style="font-size:13px;color:#166534">Your TapMyCar NFC + QR sticker is on its way. We deliver safely and fast!</div>' +
          (tracking_number ? '<div style="font-size:13px;color:#166534;margin-top:8px;font-weight:700">Tracking: ' + tracking_number + '</div>' : '') +
          '</div>' +
          '<div style="background:#F9FAFB;border-radius:14px;padding:16px;margin-bottom:16px">' +
          '<div style="font-size:13px;font-weight:700;color:#111;margin-bottom:8px">Ships to:</div>' +
          '<div style="font-size:13px;color:#6B7280">' + (order.shipping_name || "") + '<br>' + (order.shipping_address || "") + '<br>' + (order.shipping_city || "") + ', ' + (order.shipping_state || "") + ' ' + (order.shipping_zip || "") + '</div>' +
          '</div>' +
          '<a href="https://tapmycar.io/dashboard.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">Track in Dashboard</a>' +
          '</div>'
      });
    }
  }

  return res.json({ success: true });
};
