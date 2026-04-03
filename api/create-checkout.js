// Day 7: Stripe checkout session
// POST /api/create-checkout { plan, userId }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // TODO Day 7: Stripe checkout
  res.json({ url: '/dashboard.html' });
}
