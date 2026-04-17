const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { status } = req.query;

  let query = supabase.from("orders")
    .select("*, users(name, email, phone)")
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(100);

  if (status && status !== "all") query = query.eq("order_status", status);

  const { data: orders } = await query;
  return res.json({ success: true, orders: orders || [] });
};
