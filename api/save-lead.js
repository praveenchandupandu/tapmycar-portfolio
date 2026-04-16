const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { email, tag_id, rating, comment } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });

  // Save lead
  await supabase.from("leads").insert({ email, tag_id, rating, comment, source: "scan" });

  // Send welcome email
  await resend.emails.send({
    from: "TapMyCar <noreply@tapmycar.io>",
    to: email,
    subject: "Your free TapMyCar eTag is waiting!",
    html: `<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
      <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:4px">TapMyCar<span style="color:#FF6B00">.</span></div>
      <div style="font-size:13px;color:#6B7280;margin-bottom:24px">Privacy for you. Safety for your car.</div>
      <div style="font-size:22px;font-weight:800;color:#111;margin-bottom:12px">Your free eTag is waiting! 🚗</div>
      <div style="font-size:14px;color:#374151;line-height:1.6;margin-bottom:20px">
        You just used TapMyCar to contact a car owner — now protect YOUR car too!<br><br>
        With a free TapMyCar eTag, strangers can reach you privately without knowing your real number.
      </div>
      <div style="background:#FFF3EC;border-radius:14px;padding:16px;margin-bottom:20px">
        <div style="font-size:13px;font-weight:700;color:#FF6B00;margin-bottom:8px">What you get FREE:</div>
        <div style="font-size:13px;color:#374151;line-height:1.8">
          ✅ Digital QR code tag — instant<br>
          ✅ Masked calling — privacy protected<br>
          ✅ No app download needed<br>
          ✅ Works on any car, any window
        </div>
      </div>
      <a href="https://tapmycar.io/register.html" style="display:block;background:#FF6B00;color:#fff;font-size:15px;font-weight:700;padding:16px 0;border-radius:13px;text-align:center;text-decoration:none;margin-bottom:12px">Get My Free Tag →</a>
      <div style="text-align:center;font-size:11px;color:#9CA3AF">No credit card needed. Takes 2 minutes.</div>
    </div>`
  });

  return res.json({ success: true });
};
