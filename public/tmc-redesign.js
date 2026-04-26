// ═══════════════════════════════════════════════════════════════
// TAPMYCAR REDESIGN — v5 final
// Floating nav injection + smooth page transitions
// ═══════════════════════════════════════════════════════════════
// What this file does:
//   1. Adds a "tmc-redesign" class to <body> so CSS overrides activate
//   2. On the 5 main tab pages, injects a floating nav with labels
//      (Home / Tag / Verify / Activity / Profile) and HIDES the old .bnav
//   3. On nav button click, fades out the current page and navigates
//      to the next — feels smooth instead of an abrupt page jump
//   4. On page load, runs a quick fade-in animation
// To revert: delete this file and remove the <script> tag.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    // Mark body for CSS hooks
    document.body.classList.add('tmc-redesign');

    // Inject floating nav (only on pages that already have a .bnav)
    injectFloatingNav();

    // Fade-in transition on page load
    setupPageTransitions();
  }

  // ─── INJECT FLOATING NAV ──────────────────────────────────────
  function injectFloatingNav() {
    var oldNav = document.querySelector('.bnav');
    if (!oldNav) return; // page doesn't have bottom nav, skip

    document.body.classList.add('tmc-floating-nav');

    var items = [
      {
        href: '/dashboard.html',
        label: 'Home',
        match: ['/dashboard'],
        icon: '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
      },
      {
        href: '/manage.html',
        label: 'Tag',
        match: ['/manage'],
        icon: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>'
      },
      {
        href: '/verify.html',
        label: 'Verify',
        match: ['/verify'],
        icon: '<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
      },
      {
        href: '/activity.html',
        label: 'Activity',
        match: ['/activity'],
        icon: '<svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'
      },
      {
        href: '/settings.html',
        label: 'Profile',
        match: ['/settings'],
        icon: '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
      }
    ];

    var path = window.location.pathname;
    var fnav = document.createElement('nav');
    fnav.className = 'tmc-fnav';
    fnav.setAttribute('aria-label', 'Main navigation');

    items.forEach(function (item) {
      var isActive = item.match.some(function (m) { return path.indexOf(m) !== -1; });
      var a = document.createElement('a');
      a.href = item.href;
      a.className = 'tmc-fnav-item' + (isActive ? ' active' : '');
      a.setAttribute('aria-label', item.label);
      a.innerHTML =
        '<div class="tmc-fnav-icon">' + item.icon + '</div>' +
        '<span class="tmc-fnav-label">' + item.label + '</span>';

      a.addEventListener('click', function (e) {
        if (isActive) { e.preventDefault(); return; }
        e.preventDefault();
        navigateWithFade(item.href);
      });
      fnav.appendChild(a);
    });

    document.body.appendChild(fnav);
  }

  // ─── PAGE TRANSITIONS ─────────────────────────────────────────
  function navigateWithFade(href) {
    document.body.style.transition = 'opacity .18s ease-out, transform .18s ease-out';
    document.body.style.opacity = '0.4';
    document.body.style.transform = 'scale(0.98)';
    setTimeout(function () { window.location.href = href; }, 150);
  }

  function setupPageTransitions() {
    document.body.classList.add('tmc-page-transitioning');
    setTimeout(function () {
      document.body.classList.remove('tmc-page-transitioning');
    }, 500);
  }
})();
