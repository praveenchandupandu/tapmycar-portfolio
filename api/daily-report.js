const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  // Verify this is called by Vercel Cron
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const todayStr = yesterday.toISOString();

  try {
    // New users today
    const { count: newUsers } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .gte("created_at", todayStr);

    // Tags activated today
    const { count: newTags } = await supabase
      .from("tags")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .gte("activated_at", todayStr);

    // Total scans today
    const { count: scansToday } = await supabase
      .from("scan_logs")
      .select("*", { count: "exact", head: true })
      .gte("scanned_at", todayStr);

    // Revenue today
    const { data: orders } = await supabase
      .from("orders")
      .select("amount")
      .eq("status", "paid")
      .gte("created_at", todayStr);
    const revenue = orders ? orders.reduce((sum, o) => sum + (o.amount || 0), 0) / 100 : 0;

    // Total users ever
    const { count: totalUsers } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true });

    // Total active tags
    const { count: activeTags } = await supabase
      .from("tags")
      .select("*", { count: "exact", head: true })
      .eq("status", "active");

    // Total revenue ever
    const { data: allOrders } = await supabase
      .from("orders")
      .select("amount")
      .eq("status", "paid");
    const totalRevenue = allOrders ? allOrders.reduce((sum, o) => sum + (o.amount || 0), 0) / 100 : 0;

    const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

    await resend.emails.send({
      from: "TapMyCar <noreply@tapmycar.io>",
      to: "pramantechllc@gmail.com",
      subject: `TapMyCar Daily Report - ${dateStr}`,
      html: `<div style="font-family:Inter,sans-serif;max-width:500px;margin:0 auto;padding:40px 20px">
        <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:4px">TapMyCar<span style="color:#FF6B00">.</span></div>
        <div style="font-size:13px;color:#6B7280;margin-bottom:24px">Daily Operations Report</div>
        <div style="font-size:18px;font-weight:800;color:#111;margin-bottom:16px">${dateStr}</div>

        <div style="background:#FFF3EC;border:1.5px solid #FFE4CC;border-radius:14px;padding:20px;margin-bottom:16px">
          <div style="font-size:12px;font-weight:700;color:#FF6B00;margin-bottom:12px">TODAY</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div style="background:#fff;border-radius:10px;padding:12px;text-align:center">
              <div style="font-size:28px;font-weight:800;color:#FF6B00">${newUsers || 0}</div>
              <div style="font-size:11px;color:#6B7280">New Users</div>
            </div>
            <div style="background:#fff;border-radius:10px;padding:12px;text-align:center">
              <div style="font-size:28px;font-weight:800;color:#FF6B00">${newTags || 0}</div>
              <div style="font-size:11px;color:#6B7280">Tags Activated</div>
            </div>
            <div style="background:#fff;border-radius:10px;padding:12px;text-align:center">
              <div style="font-size:28px;font-weight:800;color:#FF6B00">${scansToday || 0}</div>
              <div style="font-size:11px;color:#6B7280">Scans</div>
            </div>
            <div style="background:#fff;border-radius:10px;padding:12px;text-align:center">
              <div style="font-size:28px;font-weight:800;color:#16A34A">$${revenue.toFixed(2)}</div>
              <div style="font-size:11px;color:#6B7280">Revenue</div>
            </div>
          </div>
        </div>

        <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:14px;padding:20px;margin-bottom:16px">
          <div style="font-size:12px;font-weight:700;color:#6B7280;margin-bottom:12px">ALL TIME</div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #E5E7EB">
            <div style="font-size:13px;color:#111">Total Users</div>
            <div style="font-size:13px;font-weight:700;color:#111">${totalUsers || 0}</div>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #E5E7EB">
            <div style="font-size:13px;color:#111">Active Tags</div>
            <div style="font-size:13px;font-weight:700;color:#111">${activeTags || 0}</div>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 0">
            <div style="font-size:13px;color:#111">Total Revenue</div>
            <div style="font-size:13px;font-weight:700;color:#16A34A">$${totalRevenue.toFixed(2)}</div>
          </div>
        </div>

        <a href="https://tapmycar.io/admin.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">Open Admin Dashboard</a>
        <div style="text-align:center;font-size:11px;color:#9CA3AF;margin-top:16px">Praman Tech LLC - TapMyCar Daily Report</div>
      </div>`
    });

    return res.json({ success: true, newUsers, newTags, scansToday, revenue });
  } catch(e) {
    console.error("Daily report error:", e);
    return res.status(500).json({ error: e.message });
  }
};
