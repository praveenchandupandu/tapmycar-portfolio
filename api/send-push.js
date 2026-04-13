const webpush = require("web-push");
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { user_id, title, body, url } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id required" });

  const { data: subs } = await supabase.from("push_subscriptions").select("*").eq("user_id", user_id);
  if (!subs || subs.length === 0) return res.json({ success: true, sent: 0 });

  const payload = JSON.stringify({ title: title || "TapMyCar", body: body || "Someone scanned your tag!", url: url || "/activity.html" });

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      sent++;
    } catch (err) {
      if (err.statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    }
  }
  return res.json({ success: true, sent });
};
