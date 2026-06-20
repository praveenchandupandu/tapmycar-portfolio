// TMC_PATCH69 — iOS page guard
//
// In iOS Path A mode, certain pages must NOT be viewable inside the app
// because they display pricing/payment UI. This script auto-redirects
// the iOS user to Safari (tapmycar.io equivalent) and returns the app
// to the dashboard. Web and Android: no-op.

(function () {
  if (typeof window === 'undefined') return;

  // Pages to block in iOS mode. Map: app-page → web-page.
  // Add more paths here as we identify payment-only pages.
  // TMC_PATCH75 — expanded list + query/hash preservation
    var BLOCKED_IN_IOS = {
      '/pricing.html':           '/pricing',
      '/renew.html':             '/renew',
      '/billing.html':           '/billing',
      '/activate.html':          '/activate',
      '/business.html':          '/business',
      '/for-tow-companies.html': '/for-tow-companies',
      '/pricing':       '/pricing',
      '/renew':         '/renew',
      '/billing':       '/billing',
      '/activate':      '/activate',
      '/business':      '/business',
      '/for-tow-companies': '/for-tow-companies'
    };

  function isIOS() {
    try {
      return !!(window.Capacitor &&
                typeof window.Capacitor.getPlatform === 'function' &&
                window.Capacitor.getPlatform() === 'ios');
    } catch (e) { return false; }
  }

  function currentPath() {
    var p = window.location.pathname || '/';
    // Normalize: strip trailing slash unless root
    if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
    return p;
  }

  function check() {
    if (!isIOS()) return;

    var path = currentPath();
    var webPath = BLOCKED_IN_IOS[path];
    if (!webPath) return;

    var webUrl = 'https://www.tapmycar.io' + webPath + (window.location.search || '') + (window.location.hash || '');
    console.log('[tmc-page-guard] iOS — redirecting blocked page ' + path + ' → ' + webUrl);

    // Open the web equivalent in external Safari
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
        window.Capacitor.Plugins.Browser.open({ url: webUrl });
      }
    } catch (e) { /* swallow */ }

    // Send the in-app view back to dashboard so the user lands somewhere useful
    setTimeout(function () {
      window.location.replace('/dashboard.html');
    }, 100);
  }

  // Check as soon as the script runs (before DOM, before page render)
  check();
})();
