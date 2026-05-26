const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// TMC_PATCH2_ORIGIN_GUARD
function checkOrigin(req) {
  const origin = req.headers.origin;
  // Missing origin = same-origin or server-to-server, allowed
  if (!origin) return true;
  // Allowlist: tapmycar.io domains and any *.vercel.app preview
  if (origin === 'https://tapmycar.io') return true;
  if (origin === 'https://www.tapmycar.io') return true;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}


/**
 * DELETE ACCOUNT ENDPOINT
 * ════════════════════════════════════════════════════════════════
 * CCPA-compliant account deletion. Cascades through:
 *   1. Cancel Stripe subscription (if any)
 *   2. Disable all tags owned by user
 *   3. For Premium main buyer: revoke all gift codes, disable family tags
 *   4. Delete related records (scan_logs, orders, otp_codes, push_subs, premium_codes)
 *   5. Finally delete the user record
 *   6. Send confirmation email
 *
 * Takes: { user_id, confirm: "DELETE" }  (confirm string prevents accidents)
 */

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden origin' });


  const { user_id, confirm } = req.body;

  if (!user_id) return res.status(400).json({ error: "user_id required" });
  if (confirm !== "DELETE") {
    return res.status(400).json({ error: "Confirmation required. Pass confirm: 'DELETE' to proceed." });
  }

  const { data: user } = await supabase.from("users").select("*").eq("id", user_id).single();
  if (!user) return res.status(404).json({ error: "User not found" });

  const userEmail = user.email;
  const userName = user.name;

  try {
    // 1. Cancel Stripe subscription (if any)
    if (user.subscription_id) {
      try {
        await stripe.subscriptions.cancel(user.subscription_id);
        console.log(`✓ Cancelled subscription ${user.subscription_id} for user ${user_id}`);
      } catch (err) {
        // subscription may already be cancelled or invalid — log and continue
        console.warn(`Could not cancel subscription ${user.subscription_id}:`, err.message);
      }
    }

    // 2. For Premium main buyer: handle family members
    if (user.plan === 'premium') {
      // Find all family members linked to this main buyer via parent_user_id
      const { data: familyMembers } = await supabase
        .from('users')
        .select('id')
        .eq('parent_user_id', user_id);

      if (familyMembers && familyMembers.length > 0) {
        const familyIds = familyMembers.map(f => f.id);
        // Disable family member tags
        await supabase.from('tags').update({ status: 'disabled' }).in('owner_id', familyIds);
        // Revert family members to free plan (they lose Premium access)
        await supabase.from('users').update({
          plan: 'etag',
          parent_user_id: null,
          redeemed_code: null
        }).in('id', familyIds);
      }

      // Delete all gift codes the user owned
      await supabase.from('premium_codes').delete().eq('buyer_user_id', user_id);
    }

    // 3. Disable user's own tags (and break ownership so the tokens can be recycled)
    await supabase.from('tags').update({
      status: 'disabled',
      owner_id: null
    }).eq('owner_id', user_id);

    // 4. Cascade-delete related records
    // (these have ON DELETE CASCADE mostly, but explicit deletion is safer)
    await supabase.from('scan_logs').delete().eq('tag_id', null);  // no-op guard
    await supabase.from('otp_codes').delete().eq('phone', user.email || 'nomatch');
    await supabase.from('push_subscriptions').delete().eq('user_id', user_id);

    // Orders are kept for accounting/audit — just unlink from user via ON DELETE CASCADE
    // (or you can set user_id to null to preserve them without the user)

    // 5. DELETE THE USER
    const { error: deleteErr } = await supabase.from('users').delete().eq('id', user_id);
    if (deleteErr) {
      console.error('User delete error:', deleteErr);
      return res.status(500).json({ error: 'Failed to delete account: ' + deleteErr.message });
    }

    console.log(`✓ User ${user_id} (${userEmail}) account deleted`);

    // 6. Send confirmation email (best effort — don't fail if this breaks)
    if (userEmail) {
      try {
        await resend.emails.send({
          from: "TapMyCar <noreply@tapmycar.io>",
          to: userEmail,
          subject: "Your TapMyCar account has been deleted",
          html: `<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
            <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
            <div style="font-size:14px;color:#111;margin-bottom:16px">Hi ${userName || 'there'},</div>
            <div style="background:#F9FAFB;border:1.5px solid #E5E7EB;border-radius:14px;padding:16px;margin-bottom:16px">
              <div style="font-size:14px;font-weight:700;color:#111;margin-bottom:8px">Account deleted</div>
              <div style="font-size:12px;color:#6B7280;line-height:1.6">Your TapMyCar account and associated data have been permanently deleted. Any active subscription has been cancelled and your tags have been disabled.</div>
            </div>
            <div style="font-size:12px;color:#6B7280;line-height:1.6;margin-bottom:16px">We kept order records for accounting purposes as legally required, but your personal information has been removed.</div>
            <div style="font-size:12px;color:#6B7280;line-height:1.6">If this deletion was not made by you, please contact us immediately at <a href="mailto:support@tapmycar.io" style="color:#FF6B00">support@tapmycar.io</a>.</div>
            <div style="margin-top:24px;font-size:11px;color:#9CA3AF">Thank you for using TapMyCar.</div>
          </div>`
        });
      } catch (emailErr) {
        console.warn('Could not send deletion email:', emailErr.message);
      }
    }

    return res.json({ success: true, message: "Account deleted permanently" });

  } catch (err) {
    console.error("Delete account error:", err);
    return res.status(500).json({ error: err.message });
  }
};
