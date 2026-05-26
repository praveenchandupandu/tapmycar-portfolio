const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { resolveUser, recordTokenType } = require('./_auth'); /* TMC_PATCH38S4 */

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  /* TMC_PATCH38S4: identify the caller from a signed session token or a
     legacy UUID. resolveUser() accepts both, so no logged-in user is
     locked out; the resolved id replaces any user_id the request claimed
     (IDOR fix). viaLegacy records which token type, for the counter. */
  const _tmcAuth = resolveUser(req);
  if (!_tmcAuth) return res.status(401).json({ error: 'Authentication required' });
  const user_id = _tmcAuth.userId;
  await recordTokenType(supabase, user_id, _tmcAuth.viaLegacy);

  const { data: user } = await supabase.from("users").select("referral_code, referral_count, referral_credits, referral_reward_pending").eq("id", user_id).single();
  if (!user) return res.status(404).json({ error: "User not found" });

  return res.json({ success: true, ...user });
};
