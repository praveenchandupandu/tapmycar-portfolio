// Day 6: Twilio proxy masked call
// POST /api/proxy-call { token }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // TODO Day 6: Twilio proxy session
  res.json({ success: true, message: 'Call initiated' });
}
