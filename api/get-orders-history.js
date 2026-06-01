// TMC_PATCH47_PAYMENTS
// Returns the authenticated user's own order history with credit-vs-cash
// breakdown. Last 20 orders, newest first.

const { createClient } = require('@supabase/supabase-js');
const { resolveUser } = require('./_auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, created_at, order_status, plan, amount, stripe_id, sticker_count')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) return res.status(500).json({ error: error.message });

    if (!orders || orders.length === 0) {
      return res.json({ ok: true, orders: [] });
    }

    /* Pull referral consumptions for these orders so we can show credit
       applied. Only rows with consumed_order_id are useful here. */
    const orderIds = orders.map(o => o.id);
    const { data: creditRows } = await supabase
      .from('referrals')
      .select('consumed_order_id, credit_amount')
      .in('consumed_order_id', orderIds);

    const creditByOrder = {};
    (creditRows || []).forEach(function (r) {
      if (!r.consumed_order_id) return;
      const cents = Math.round((parseFloat(r.credit_amount) || 0) * 100);
      creditByOrder[r.consumed_order_id] = (creditByOrder[r.consumed_order_id] || 0) + cents;
    });

    const out = orders.map(function (o) {
      const amountCents = parseInt(o.amount || 0, 10) || 0;
      const creditCents = creditByOrder[o.id] || 0;
      return {
        id: o.id,
        created_at: o.created_at,
        order_status: o.order_status,
        plan: o.plan,
        amount_cents:  amountCents,
        credit_cents:  creditCents,
        total_cents:   amountCents + creditCents,
        free:          amountCents === 0 && creditCents > 0,
        sticker_count: o.sticker_count || 0
      };
    });

    return res.json({ ok: true, orders: out });
  } catch (e) {
    console.error('get-orders-history error:', e && e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
