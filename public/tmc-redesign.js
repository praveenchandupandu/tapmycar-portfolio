// ═════════════════════════════════════════════════════════════
// TAPMYCAR REDESIGN — minimal JS (v7)
// Adds the redesign body class and lights the active nav tab.
//
// v7: setActiveNavItem now runs reliably no matter where this script is
//     loaded. The previous version called it once before the floating nav
//     was parsed, found nothing, and never retried — so no tab ever lit up.
//     Now we run on DOMContentLoaded (or immediately if already loaded),
//     retry briefly in case the nav arrives late, and re-apply on bfcache
//     restore (pageshow). The neon glow itself lives in tmc-redesign.css.
// ═════════════════════════════════════════════════════════════
(function () {
  // Apply the redesign class to <html> immediately (before paint),
  // and to <body> as soon as it exists.
  document.documentElement.classList.add('tmc-redesign');

  function applyBodyClass() {
    if (document.body && !document.body.classList.contains('tmc-redesign')) {
      document.body.classList.add('tmc-redesign');
    }
  }

  // Light the nav item whose data-match is contained in the URL path.
  // Returns true once at least one nav item is present (so we can stop retrying).
  function setActiveNavItem() {
    var items = document.querySelectorAll('.tmc-fnav-item');
    if (!items.length) return false;
    var path = window.location.pathname.toLowerCase();
    items.forEach(function (item) {
      var raw = item.getAttribute('data-match') || '';
      var matches = raw.split(',').map(function (m) { return m.trim().toLowerCase(); }).filter(Boolean);
      var isActive = matches.some(function (m) { return path.indexOf(m) !== -1; });
      item.classList.toggle('active', isActive);
    });
    return true;
  }

  function run() {
    applyBodyClass();
    // If the nav is not in the DOM yet, retry on a short interval
    // (covers the case where this script runs before the nav markup is parsed).
    if (!setActiveNavItem()) {
      var tries = 0;
      var iv = setInterval(function () {
        if (setActiveNavItem() || ++tries >= 20) clearInterval(iv);
      }, 50);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

  // Re-apply when the page is restored from the back/forward cache.
  window.addEventListener('pageshow', function () {
    applyBodyClass();
    setActiveNavItem();
  });
})();
