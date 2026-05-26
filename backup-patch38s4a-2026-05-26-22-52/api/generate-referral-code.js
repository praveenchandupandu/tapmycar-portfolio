const { createClient } = require("@supabase/supabase-js");
const crypto = require('crypto');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "TMC-";
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id required" });

  // Check if already has code
  const { data: user } = await supabase.from("users").select("referral_code").eq("id", user_id).single();
  if (user?.referral_code) return res.json({ success: true, code: user.referral_code });

  // Generate unique code
  let code, exists = true;
  while (exists) {
    code = generateCode();
    const { data } = await supabase.from("users").select("id").eq("referral_code", code).single();
    exists = !!data;
  }

  await supabase.from("users").update({ referral_code: code }).eq("id", user_id);
  return res.json({ success: true, code });
};
