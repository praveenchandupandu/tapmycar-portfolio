// TMC_PATCH40_ADMIN_LOGIN
// POST { key }. Verifies the key against ADMIN_SECRET_KEY. On success,
// sets a signed httpOnly admin session cookie and returns { success:true }.
// The raw key is never stored in the browser — only this cookie, which
// page JavaScript cannot read.
//
// Stage 1: this endpoint exists but nothing calls it yet. Stage 2 points
// the admin login form here.

const crypto = require('crypto');
const { signAdminSession, adminCookie } = require('./_admin-auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ADMIN_KEY = process.env.ADMIN_SECRET_KEY || '';
  if (!ADMIN_KEY || !process.env.JWT_SECRET) {
    return res.status(500).json({ error: 'Server auth not configured' });
  }

  const body = req.body || {};
  const key = body.key != null ? String(body.key) : '';

  /* constant-time comparison so a wrong key cannot be timing-probed */
  let ok = false;
  try {
    const a = Buffer.from(key);
    const b = Buffer.from(ADMIN_KEY);
    ok = (a.length === b.length) && crypto.timingSafeEqual(a, b);
  } catch (e) {
    ok = false;
  }

  if (!ok) {
    return res.status(401).json({ error: 'Invalid admin key' });
  }

  try {
    const token = signAdminSession();
    res.setHeader('Set-Cookie', adminCookie(token));
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Could not start admin session' });
  }
};
