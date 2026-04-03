// Day 7: Stripe webhook handler
// POST /api/stripe-webhook
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // TODO Day 7: verify Stripe signature, handle events
  res.json({ received: true });
}
