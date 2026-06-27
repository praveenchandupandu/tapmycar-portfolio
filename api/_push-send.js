// TMC_PUSH_FCM_HELPER
// Backend FCM (mobile push) helper. Sends notifications via Firebase Cloud
// Messaging to user devices registered through @capacitor/push-notifications.
//
// This is the SHARED helper called by:
//   - scan-notify.js     (someone scanned the tag)
//   - tow-notify.js      (tow company reported the car)
//   - billing crons      (renewal reminders, payment failures)
//   - send-broadcast.js  (admin sending broadcasts)
//   - and any future trigger
//
// Design principles:
//   1. SAFE: a failure to send a push MUST NEVER throw to the caller.
//      The caller's primary job (recording a scan, processing a refund)
//      is more important than the notification.
//   2. CACHED: Firebase Admin SDK init is expensive; cache the instance
//      across warm Vercel invocations.
//   3. SELF-CLEANING: invalid FCM tokens (uninstalled apps, etc.) are
//      auto-removed from push_subscriptions on first failed send.
//   4. AUDITED: every send (success or failure) is logged to
//      notifications_log with channel='mobile_push' so the admin UI can
//      report on delivery.
//
// Environment requirements:
//   FIREBASE_SERVICE_ACCOUNT  — the full JSON of the service account key
//                               (set as a Vercel env var)
//   SUPABASE_URL, SUPABASE_SERVICE_KEY — already required elsewhere

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// --- Firebase Admin singleton -----------------------------------------
// Initialized lazily on first call. Cached on globalThis so multiple
// Vercel function instances reusing the same warm container share it.

let _fbApp = null;
let _fbInitError = null;

function getFirebaseAdmin() {
  if (_fbApp) return _fbApp;
  if (_fbInitError) return null; // we already failed once — don't retry endlessly

  try {
    const admin = require('firebase-admin');

    // If an app is already initialized in this process (warm container),
    // reuse it. firebase-admin throws if you init twice with the same name.
    if (admin.apps.length > 0) {
      _fbApp = admin.app();
      return _fbApp;
    }

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      _fbInitError = new Error('FIREBASE_SERVICE_ACCOUNT env var not set');
      console.error('TMC_PUSH_FCM_HELPER:', _fbInitError.message);
      return null;
    }

    let svc;
    try {
      svc = JSON.parse(raw);
    } catch (e) {
      _fbInitError = new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
      console.error('TMC_PUSH_FCM_HELPER:', _fbInitError.message);
      return null;
    }

    _fbApp = admin.initializeApp({
      credential: admin.credential.cert(svc),
      projectId: svc.project_id
    });

    return _fbApp;
  } catch (e) {
    _fbInitError = e;
    console.error('TMC_PUSH_FCM_HELPER: init failed:', e && e.message);
    return null;
  }
}

// --- Internal: log a send to notifications_log ------------------------

async function _logSend(userId, contact, subject, bodyPreview, eventType, status, errorMsg, sentBy, broadcastId) {
  try {
    const row = {
      channel: 'mobile_push',
      event_type: eventType || 'system',
      recipient_user_id: userId,
      recipient_contact: contact || 'fcm',
      subject: (subject || '').slice(0, 500),
      body_preview: (bodyPreview || '').slice(0, 1000),
      sent_by: sentBy || 'system',
      status: status
    };
    if (errorMsg) row.error = errorMsg.slice(0, 500);
    if (broadcastId) row.broadcast_id = broadcastId;
    await supabase.from('notifications_log').insert([row]);
  } catch (e) {
    // never throw — logging failure must not break a real send
    console.error('TMC_PUSH_FCM_HELPER: notifications_log insert failed:', e && e.message);
  }
}

// --- Internal: send to a single FCM token -----------------------------
// Returns { ok: boolean, error?: string, shouldDeleteToken: boolean }

async function _sendOneToken(messaging, token, payload) {
  try {
    const message = {
      token: token,
      notification: {
        title: payload.title,
        body: payload.body
      },
      // `data` lets us attach a deep link target etc. that the app reads
      // when the user taps the notification. Values MUST be strings.
      data: payload.data
        ? Object.fromEntries(
            Object.entries(payload.data).map(([k, v]) => [k, String(v)])
          )
        : {},
      android: {
        priority: 'high',
        notification: {
          // Use the app's default icon and color from the manifest.
          sound: 'default',
          channelId: payload.channelId || 'default',
          icon: 'ic_stat_icon',
          color: '#FF6B00',
          imageUrl: payload.imageUrl || 'https://www.tapmycar.io/icon-512.png'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: payload.badge
          }
        }
      }
    };

    await messaging.send(message);
    return { ok: true, shouldDeleteToken: false };
  } catch (e) {
    const code = (e && e.errorInfo && e.errorInfo.code) || (e && e.code) || '';
    const msg = (e && e.message) || String(e);

    // These error codes mean the token is dead — uninstalled, refreshed,
    // or unregistered. Delete it from our DB.
    // https://firebase.google.com/docs/cloud-messaging/manage-tokens
    const deadTokenCodes = [
      'messaging/registration-token-not-registered',
      'messaging/invalid-registration-token',
      'messaging/invalid-argument'
    ];
    const isDead = deadTokenCodes.indexOf(code) !== -1
      || /not[- ]?registered|not[- ]?found|invalid.*token/i.test(msg);

    return { ok: false, error: msg, shouldDeleteToken: isDead };
  }
}

// --- Internal: fetch FCM tokens for a list of user_ids ----------------

async function _getTokensForUsers(userIds) {
  if (!userIds || userIds.length === 0) return [];
  // Supabase 'in' clause works fine up to ~1000 ids
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('user_id, fcm_token, platform')
    .in('user_id', userIds)
    .not('fcm_token', 'is', null);
  if (error) {
    console.error('TMC_PUSH_FCM_HELPER: token fetch error:', error.message);
    return [];
  }
  return data || [];
}

// --- Public: send push to a single user -------------------------------

async function sendPushToUser(userId, payload, opts) {
  return await sendPushToUsers([userId], payload, opts);
}

// --- Public: send push to multiple users ------------------------------

async function sendPushToUsers(userIds, payload, opts) {
  opts = opts || {};
  const result = { sent: 0, failed: 0, deleted: 0, skipped: 0 };

  if (!userIds || userIds.length === 0) return result;
  if (!payload || (!payload.title && !payload.body)) {
    console.error('TMC_PUSH_FCM_HELPER: missing payload title/body');
    return result;
  }

  // Init Firebase. If it fails, we still log skipped sends for audit.
  const app = getFirebaseAdmin();
  if (!app) {
    for (const uid of userIds) {
      await _logSend(uid, 'fcm', payload.title, payload.body,
        opts.eventType, 'failed', 'firebase-admin not initialized',
        opts.sentBy, opts.broadcastId);
      result.failed += 1;
    }
    return result;
  }

  // Look up all tokens for these users
  const tokens = await _getTokensForUsers(userIds);
  if (tokens.length === 0) {
    // No subscribed devices — that's normal, not an error
    for (const uid of userIds) {
      await _logSend(uid, 'fcm', payload.title, payload.body,
        opts.eventType, 'skipped', 'no fcm token', opts.sentBy, opts.broadcastId);
      result.skipped += 1;
    }
    return result;
  }

  const messaging = require('firebase-admin').messaging();

  // Group by user_id for per-user audit logging
  const tokensByUser = {};
  for (const row of tokens) {
    if (!tokensByUser[row.user_id]) tokensByUser[row.user_id] = [];
    tokensByUser[row.user_id].push(row.fcm_token);
  }

  for (const uid of userIds) {
    const userTokens = tokensByUser[uid] || [];
    if (userTokens.length === 0) {
      await _logSend(uid, 'fcm', payload.title, payload.body,
        opts.eventType, 'skipped', 'no fcm token', opts.sentBy, opts.broadcastId);
      result.skipped += 1;
      continue;
    }

    let userSent = 0;
    let userErrors = [];
    for (const tok of userTokens) {
      const r = await _sendOneToken(messaging, tok, payload);
      if (r.ok) {
        userSent += 1;
        result.sent += 1;
      } else {
        userErrors.push(r.error);
        result.failed += 1;
        if (r.shouldDeleteToken) {
          try {
            await supabase
              .from('push_subscriptions')
              .delete()
              .eq('fcm_token', tok);
            result.deleted += 1;
            console.log('TMC_PUSH_FCM_HELPER: removed dead token for user', uid);
          } catch (delErr) {
            console.error('TMC_PUSH_FCM_HELPER: failed to delete dead token:', delErr && delErr.message);
          }
        }
      }
    }

    // One audit row per user, summarizing all their devices
    await _logSend(
      uid, 'fcm', payload.title, payload.body,
      opts.eventType,
      userSent > 0 ? 'sent' : 'failed',
      userSent > 0 ? null : userErrors.join('; '),
      opts.sentBy, opts.broadcastId
    );
  }

  return result;
}

// --- Public: send push to ALL users with FCM tokens -------------------

async function sendPushToAll(payload, opts) {
  // Fetch every distinct user_id that has an FCM token.
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('user_id')
    .not('fcm_token', 'is', null);
  if (error) {
    console.error('TMC_PUSH_FCM_HELPER: sendPushToAll user fetch error:', error.message);
    return { sent: 0, failed: 0, deleted: 0, skipped: 0 };
  }
  const uniqueIds = Array.from(new Set((data || []).map(r => r.user_id)));
  return await sendPushToUsers(uniqueIds, payload, opts);
}

// --- Public: send push to users matching a filter ---------------------
// filter is a function: (user) => boolean. Examples:
//   sendPushToSegment(u => u.plan === 'premium', payload)
//   sendPushToSegment(u => u.created_at < cutoff, payload)

async function sendPushToSegment(filterFn, payload, opts) {
  if (typeof filterFn !== 'function') {
    console.error('TMC_PUSH_FCM_HELPER: sendPushToSegment requires a filter function');
    return { sent: 0, failed: 0, deleted: 0, skipped: 0 };
  }

  // Pull users in batches to avoid pulling everything at once
  const matchedIds = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('TMC_PUSH_FCM_HELPER: sendPushToSegment fetch error:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const u of data) {
      try { if (filterFn(u)) matchedIds.push(u.id); }
      catch (e) { /* skip filter errors */ }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return await sendPushToUsers(matchedIds, payload, opts);
}

module.exports = {
  sendPushToUser,
  sendPushToUsers,
  sendPushToAll,
  sendPushToSegment,
  // Exposed for testing / debugging only
  _getFirebaseAdmin: getFirebaseAdmin
};
