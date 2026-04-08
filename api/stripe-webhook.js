const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(400).json({ error: err.message });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { user_id, plan, address } = session.metadata;

    // Save order
    await supabase.from('orders').insert({
      user_id,
      plan: plan || 'etag',
      amount: session.amount_total,
      stripe_id: session.id,
      status: 'paid'
    });

    // Activate the user's tag
    await supabase
      .from('tags')
      .update({
        status: 'active',
        activated_at: new Date().toISOString(),
        plan: plan || 'etag'
      })
      .eq('owner_id', user_id);

    // Update user plan
    await supabase
      .from('users')
      .update({ plan: plan || 'standard' })
      .eq('id', user_id);

    console.log('Payment completed for user:', user_id);
  }

  res.json({ received: true });
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}