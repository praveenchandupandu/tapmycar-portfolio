// TMC_TEST_PUSH — Admin-only endpoint to fire a test push notification.
// Use this to verify the FCM bridge works end-to-end before wiring it
// into real triggers (scan-notify, tow-notify, billing crons, etc.).
//
// Usage (admin must be logged in):
//   POST /api/admin-test-push
//   Body: { user_id: "<target>", title?: "...", body?: "..." }
//
// Returns the same result shape as sendPushToUser:
//   { sent, failed, deleted, skipped }

const { resolveAdmin } = require('./_admin-auth');
const { sendPushToUser } = require('./_push-send');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!resolveAdmin(req)) {
    return res.status(401).json({ error: 'Admin auth required' });
  }

  const { user_id, title, body, data } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const result = await sendPushToUser(
    user_id,
    {
      title: title || 'TapMyCar test',
      body:  body  || 'If you see this, mobile push is working ✓',
      data:  data  || { type: 'test' }
    },
    { eventType: 'admin_test', sentBy: 'admin' }
  );

  return res.json({ ok: true, result });
};
