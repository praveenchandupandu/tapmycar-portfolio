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
