// TMC_PATCH40_ADMIN_LOGOUT
// POST. Clears the admin session cookie. Always succeeds (idempotent).

const { clearAdminCookie } = require('./_admin-auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Set-Cookie', clearAdminCookie());
  return res.status(200).json({ success: true });
};
