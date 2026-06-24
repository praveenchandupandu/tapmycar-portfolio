// TMC_FCM_MOBILE - Push notification registration for Capacitor app.
//
// Triggers when:
//   - window.tmcIsInApp === true (inside Capacitor; safe on web - no-op)
//   - User is signed in (has tmc_session_token in localStorage)
//
// Flow:
//   1. Request notification permission (system dialog appears)
//   2. If granted, register with FCM to get a token unique to this device
//   3. POST the token to /api/save-push-subscription (Bearer token auto-attached by app.js wrapper)
//   4. Listen for foreground notifications -> show in-app toast
//   5. Listen for notification taps -> deep link to the right page
//
// Idempotent: it's OK to load this on every page. Re-registering with
// FCM each app open is recommended practice - tokens can rotate, and our
// save endpoint upserts on fcm_token so duplicates do not pile up.

(function () {
  if (typeof window === 'undefined') return;

  // Wait until tmc-platform.js has set window.tmcIsInApp / window.tmcPlatform.
  function whenPlatformReady(cb) {
    if (typeof window.tmcIsInApp !== 'undefined') { cb(); return; }
    setTimeout(function () { whenPlatformReady(cb); }, 100);
  }

  function getSessionToken() {
    try { return localStorage.getItem('tmc_session_token'); } catch (e) { return null; }
  }

  function getCapacitor() {
    return (window.Capacitor && window.Capacitor.Plugins) || null;
  }

  async function registerPush() {
    if (!window.tmcIsInApp) return; // web -> no-op, web push uses a different path

    if (!getSessionToken()) {
      // Not signed in yet. We will be triggered again on the next page load,
      // which after sign-in lands on dashboard with a session token present.
      return;
    }

    var plugins = getCapacitor();
    if (!plugins || !plugins.PushNotifications) {
      console.warn('[tmc-push] PushNotifications plugin not available');
      return;
    }
    var Push = plugins.PushNotifications;

    // --- Listeners (must be set BEFORE register()) ---

    Push.addListener('registration', async function (tokenInfo) {
      var token = tokenInfo && tokenInfo.value;
      if (!token) { console.warn('[tmc-push] empty token'); return; }
      console.log('[tmc-push] FCM token received:', token.slice(0, 24) + '...');

      try {
        var res = await fetch('/api/save-push-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Authorization: Bearer <session_token> is auto-attached by
          // the app.js fetch wrapper (Patch 38S3).
          body: JSON.stringify({
            fcm_token: token,
            platform: window.tmcPlatform // 'android' or 'ios'
          })
        });
        var data = {};
        try { data = await res.json(); } catch (e) {}
        if (res.ok && data && data.success) {
          console.log('[tmc-push] token saved to server');
          try { localStorage.setItem('tmc_push_registered', '1'); } catch (e) {}
        } else {
          console.error('[tmc-push] save failed:', res.status, data);
        }
      } catch (e) {
        console.error('[tmc-push] save error:', e && e.message);
      }
    });

    Push.addListener('registrationError', function (err) {
      console.error('[tmc-push] registration error:', err);
    });

    Push.addListener('pushNotificationReceived', function (notification) {
      // Fires when a push arrives while the app is in FOREGROUND.
      // Android suppresses the system notification in this case, so we
      // show an in-app toast instead.
      console.log('[tmc-push] received (foreground):', notification);
      if (typeof window.showToast === 'function') {
        var msg = (notification && (notification.title || notification.body)) || 'New notification';
        try { window.showToast(msg); } catch (e) {}
      }
    });

    Push.addListener('pushNotificationActionPerformed', function (action) {
      // Fires when the user TAPS the notification (app was background/closed).
      console.log('[tmc-push] tapped:', action);
      var data = (action && action.notification && action.notification.data) || {};
      // Deep link based on type. Default: dashboard.
      var dest = '/dashboard.html';
      if (data.type === 'tow') dest = '/dashboard.html#tows';
      else if (data.type === 'billing') dest = '/billing.html';
      else if (data.type === 'scan') dest = '/dashboard.html';
      else if (data.type === 'security') dest = '/profile.html';
      else if (data.url) dest = data.url;
      try { window.location.href = dest; } catch (e) {}
    });

    // --- Permission + register ---

    try {
      var perm = await Push.requestPermissions();
      if (perm && perm.receive === 'granted') {
        await Push.register();
      } else {
        console.log('[tmc-push] permission not granted:', perm && perm.receive);
      }
    } catch (e) {
      console.error('[tmc-push] permission/register error:', e && e.message);
    }
  }

  function start() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { whenPlatformReady(registerPush); });
    } else {
      whenPlatformReady(registerPush);
    }
  }

  start();

  // Expose for manual testing in DevTools / from sign-in success handler.
  window.tmcRegisterPush = registerPush;
})();
