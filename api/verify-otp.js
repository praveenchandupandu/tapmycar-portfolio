// Day 3: OTP verify + create/login user
// POST /api/verify-otp { phone, code }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { phone, code } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' });
  // TODO Day 3: verify code, create user, return token
  if (code === '123456') {
    return res.json({ token: 'dev_token_' + Date.now(), name: 'Test User' });
  }
  res.status(400).json({ error: 'Invalid code' });
}
