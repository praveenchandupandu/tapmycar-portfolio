// Day 3: Twilio OTP send
// POST /api/send-otp { phone }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  // TODO Day 3: Twilio verify + Supabase save
  console.log('OTP requested for:', phone);
  res.json({ success: true, message: 'OTP sent' });
}
