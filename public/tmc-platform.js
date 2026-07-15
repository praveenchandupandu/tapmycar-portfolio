// TMC_PATCH67 — Platform detection + web-navigation helper
//
// Exposes:
//   window.tmcPlatform     "web" | "ios" | "android"
//   window.tmcIsInApp      true when running inside Capacitor
//   window.tmcOpenWeb(path) Opens tapmycar.io in the right way per platform
//
// On body load adds classes:
//   .tmc-platform-web | .tmc-platform-ios | .tmc-platform-android
//   .tmc-in-app (mobile) | .tmc-in-web (browser)
//
// Use these classes in CSS to hide/show platform-specific UI in future patches.

(function () {
  if (typeof window === 'undefined') return;

  function getPlatform() {
    try {
      if (window.Capacitor && typeof window.Capacitor.getPlatform === 'function') {
        return window.Capacitor.getPlatform();
      }
    } catch (e) { /* fall through */ }
    return 'web';
  }

  var platform = getPlatform();
  var inApp = (platform === 'ios' || platform === 'android');

  window.tmcPlatform = platform;
  window.tmcIsInApp = inApp;

  // Add body classes once DOM is ready
  function addBodyClasses() {
    if (!document.body) return;
    document.body.classList.add('tmc-platform-' + platform);
    document.body.classList.add(inApp ? 'tmc-in-app' : 'tmc-in-web');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addBodyClasses);
  } else {
    addBodyClasses();
  }

  // Open a URL on tapmycar.io. In the app, uses Capacitor Browser plugin
  // (opens Safari/Chrome externally). On the web, normal navigation.
  window.tmcOpenWeb = async function (pathOrUrl) {
    var url;
    if (!pathOrUrl) {
      url = 'https://tapmycar.io/';
    } else if (pathOrUrl.indexOf('http://') === 0 || pathOrUrl.indexOf('https://') === 0) {
      url = pathOrUrl;
    } else if (pathOrUrl.indexOf('/') === 0) {
      url = 'https://tapmycar.io' + pathOrUrl;
    } else {
      url = 'https://tapmycar.io/' + pathOrUrl;
    }

    // TMC_PATCH107_EMAIL_HANDOFF + TMC_PATCH109_EMAIL_FETCH_FALLBACK
    // Pass along the signed-in user's email so the external browser
    // (separate storage from the app) can pre-fill sign-in instead of
    // asking for it from scratch. Most accounts log in by phone, so
    // tmc_email may never have been cached - fetch it fresh if missing.
    try {
      var tmcSavedEmail = localStorage.getItem('tmc_email');
      if (!tmcSavedEmail) {
        var tmcToken = localStorage.getItem('tmc_token');
        if (tmcToken) {
          try {
            var tmcResp = await fetch('/api/get-dashboard?user_id=' + tmcToken);
            var tmcData = await tmcResp.json();
            if (tmcData && tmcData.user && tmcData.user.email) {
              tmcSavedEmail = tmcData.user.email;
              localStorage.setItem('tmc_email', tmcSavedEmail);
            }
          } catch (fetchErr) { /* network issue - proceed without email */ }
        }
      }
      if (tmcSavedEmail) {
        var sep = url.indexOf('?') === -1 ? '?' : '&';
        url = url + sep + 'tmc_email=' + encodeURIComponent(tmcSavedEmail);
      }
    } catch (e) { /* localStorage unavailable - ignore */ }

    if (!inApp) {
      window.location.href = url;
      return;
    }

    // In app: try Capacitor Browser plugin first
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
        await window.Capacitor.Plugins.Browser.open({ url: url });
        return;
      }
    } catch (e) { /* fall through to default */ }

    // Fallback
    window.location.href = url;
  };
})();

// TMC_PATCH68 — Platform-aware Stripe checkout helper
//
// Use this anywhere you would have done window.location.href = stripeUrl.
// On web: identical behavior (window.location.href = url).
// In app: opens URL in external browser via @capacitor/browser plugin.
// Falls back to window.location.href if Browser plugin not available.

(function () {
  if (typeof window === 'undefined') return;

  window.tmcStartCheckout = async function (checkoutUrl) {
    if (!checkoutUrl || typeof checkoutUrl !== 'string') {
      console.error('tmcStartCheckout: invalid url', checkoutUrl);
      return;
    }

    // On web: normal redirect
    if (!window.tmcIsInApp) {
      window.location.href = checkoutUrl;
      return;
    }

    // In app: open in external browser (Safari/Chrome)
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
        await window.Capacitor.Plugins.Browser.open({ url: checkoutUrl });
        return;
      }
    } catch (e) {
      console.error('Browser plugin failed, falling back:', e);
    }

    // Fallback if Browser plugin unavailable
    window.location.href = checkoutUrl;
  };
})();
