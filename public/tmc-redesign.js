// ═══════════════════════════════════════════════════════════════
// TAPMYCAR REDESIGN v6 — minimal JS
// Just adds active state to nav and the redesign body class.
// The nav HTML itself is embedded directly in each page (no flicker).
// ═══════════════════════════════════════════════════════════════
(function () {
  // Add body class IMMEDIATELY (synchronous, before any paint)
  // so all CSS overrides apply before the user sees anything.
  document.documentElement.classList.add('tmc-redesign');
  if (document.body) {
    document.body.classList.add('tmc-redesign');
  } else {
    // body not yet parsed — listen for it
    document.addEventListener('DOMContentLoaded', function () {
      document.body.classList.add('tmc-redesign');
      setActiveNavItem();
    });
    return;
  }

  // Set active state on the floating nav
  function setActiveNavItem() {
    var path = window.location.pathname.toLowerCase();
    var items = document.querySelectorAll('.tmc-fnav-item');
    items.forEach(function (item) {
      var match = item.getAttribute('data-match') || '';
      var matches = match.split(',').map(function (m) { return m.trim(); }).filter(Boolean);
      var isActive = matches.some(function (m) { return path.indexOf(m) !== -1; });
      if (isActive) item.classList.add('active');
      else item.classList.remove('active');
    });
  }
  setActiveNavItem();
})();
