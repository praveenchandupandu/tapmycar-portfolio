// TMC_PATCH26_APP_SETTINGS
// Shared frontend module: fetches /api/get-settings and renders the
// settings into named slot containers on the current page.
//
// Usage on a page:
//   <div data-tmc-slot="landing.hero"></div>
//   <script src="/app-settings.js"></script>
//
// Slot containers receive innerHTML based on which settings include
// the slot in their slots[] array.
//
// Slot → setting rendering:
//   landing.hero    → App Store + Play Store badges (download row)
//   landing.demo    → Demo video embed (YouTube iframe)
//   landing.footer  → Social icons + support email (icon row)
//   dashboard.banner → App Store + Play Store badges
//   dashboard.help  → Support email link
//   signin.footer   → Support email link

(function() {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function youTubeEmbed(url) {
    // Accept https://youtu.be/X, https://www.youtube.com/watch?v=X, or https://www.youtube.com/embed/X
    if (!url) return '';
    var m = url.match(/(?:youtu\.be\/|v=|\/embed\/)([A-Za-z0-9_-]{6,20})/);
    if (m) return 'https://www.youtube.com/embed/' + m[1];
    // Vimeo
    var v = url.match(/vimeo\.com\/(\d+)/);
    if (v) return 'https://player.vimeo.com/video/' + v[1];
    return url; // assume it's already an embed URL
  }

  function badgesHtml(settings, slotId) {
    var appStore = settings.app_store_url;
    var playStore = settings.play_store_url;
    var hasApp = appStore && appStore.value && (appStore.slots || []).indexOf(slotId) >= 0;
    var hasPlay = playStore && playStore.value && (playStore.slots || []).indexOf(slotId) >= 0;
    if (!hasApp && !hasPlay) return '';
    var parts = [];
    if (hasApp) {
      parts.push(
        '<a href="' + esc(appStore.value) + '" target="_blank" rel="noopener" class="tmc-badge tmc-badge-app" aria-label="Download on the App Store">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>' +
          '<span><small>Download on the</small><strong>App Store</strong></span>' +
        '</a>'
      );
    }
    if (hasPlay) {
      parts.push(
        '<a href="' + esc(playStore.value) + '" target="_blank" rel="noopener" class="tmc-badge tmc-badge-play" aria-label="Get it on Google Play">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20.5v-17c0-.83 1-.83 1.5-.5l14 8.5-14 8.5c-.5.33-1.5.33-1.5-.5z" fill="#34A853"/><path d="M3 3.5l8.5 8.5L3 20.5z" fill="#4285F4"/><path d="M17 15.5l-5.5-3.5 5.5-3.5 2 2.1c.7.7.7 2.3 0 3z" fill="#FBBC05"/></svg>' +
          '<span><small>Get it on</small><strong>Google Play</strong></span>' +
        '</a>'
      );
    }
    return '<div class="tmc-badges">' + parts.join('') + '</div>';
  }

  function videoHtml(settings, slotId) {
    var dv = settings.demo_video_url;
    if (!dv || !dv.value || (dv.slots || []).indexOf(slotId) < 0) return '';
    var embed = youTubeEmbed(dv.value);
    if (!embed) return '';
    return '<div class="tmc-video"><iframe src="' + esc(embed) + '" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy" title="Demo video"></iframe></div>';
  }

  function socialHtml(settings, slotId) {
    var entries = [
      { key: 'social_instagram', label: 'Instagram', path: '<path d="M16 11.37a4 4 0 1 1-7.94 1.18A4 4 0 0 1 16 11.37z"/><path d="M17.5 6.5h.01"/><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>' },
      { key: 'social_twitter',   label: 'Twitter / X', path: '<path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"/>' },
      { key: 'social_facebook',  label: 'Facebook', path: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>' },
      { key: 'social_linkedin',  label: 'LinkedIn', path: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>' }
    ];
    var icons = entries.filter(function(e) {
      var s = settings[e.key];
      return s && s.value && (s.slots || []).indexOf(slotId) >= 0;
    }).map(function(e) {
      var s = settings[e.key];
      return '<a href="' + esc(s.value) + '" target="_blank" rel="noopener" aria-label="' + esc(e.label) + '" class="tmc-social"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + e.path + '</svg></a>';
    }).join('');
    return icons;
  }

  function supportEmailHtml(settings, slotId) {
    var s = settings.support_email;
    if (!s || !s.value || (s.slots || []).indexOf(slotId) < 0) return '';
    return '<a href="mailto:' + esc(s.value) + '" class="tmc-support-email">' + esc(s.value) + '</a>';
  }

  function csPhoneHtml(settings, slotId) {
    var s = settings.cs_phone;
    if (!s || !s.value || (s.slots || []).indexOf(slotId) < 0) return '';
    return '<a href="tel:' + esc(s.value.replace(/[^+0-9]/g, '')) + '" class="tmc-support-phone">' + esc(s.value) + '</a>';
  }

  // Render the right combo of widgets per slot.
  function renderSlot(el, settings) {
    var slotId = el.dataset.tmcSlot;
    var html = '';
    if (slotId === 'landing.hero' || slotId === 'dashboard.banner') {
      html += badgesHtml(settings, slotId);
    } else if (slotId === 'landing.demo') {
      html += videoHtml(settings, slotId);
    } else if (slotId === 'landing.footer') {
      var social = socialHtml(settings, slotId);
      var email = supportEmailHtml(settings, slotId);
      var phone = csPhoneHtml(settings, slotId);
      var inner = (social ? '<div class="tmc-social-row">' + social + '</div>' : '') +
                  ((email || phone) ? '<div class="tmc-contact-row">' + email + (email && phone ? '<span class="tmc-dot">·</span>' : '') + phone + '</div>' : '');
      html += inner;
    } else if (slotId === 'dashboard.help' || slotId === 'signin.footer') {
      var email2 = supportEmailHtml(settings, slotId);
      var phone2 = csPhoneHtml(settings, slotId);
      html += (email2 || phone2) ? '<div class="tmc-contact-row">' + email2 + (email2 && phone2 ? '<span class="tmc-dot">·</span>' : '') + phone2 + '</div>' : '';
    }
    el.innerHTML = html;
    el.style.display = html ? '' : 'none';
  }

  function renderAll(settings) {
    var slots = document.querySelectorAll('[data-tmc-slot]');
    slots.forEach(function(el) { renderSlot(el, settings); });
  }

  function fetchAndRender() {
    var slots = document.querySelectorAll('[data-tmc-slot]');
    if (slots.length === 0) return;
    fetch('/api/get-settings').then(function(r) { return r.json(); }).then(function(d) {
      if (!d || !d.success || !d.settings) return;
      renderAll(d.settings);
    }).catch(function() {});
  }

  // Inject the minimum CSS needed once.
  function injectCss() {
    if (document.getElementById('tmc-settings-css')) return;
    var st = document.createElement('style');
    st.id = 'tmc-settings-css';
    st.textContent = [
      '.tmc-badges{display:flex;gap:10px;flex-wrap:wrap}',
      '.tmc-badge{display:inline-flex;align-items:center;gap:10px;background:#0F1B2F;color:#fff;text-decoration:none;padding:9px 14px;border-radius:12px;font-family:inherit;transition:transform .12s}',
      '.tmc-badge:hover{transform:translateY(-2px)}',
      '.tmc-badge span{display:flex;flex-direction:column;line-height:1.1}',
      '.tmc-badge small{font-size:9px;opacity:.75;font-weight:500}',
      '.tmc-badge strong{font-size:14px;font-weight:800;letter-spacing:.01em}',
      '.tmc-video{position:relative;width:100%;max-width:560px;aspect-ratio:16/9;border-radius:16px;overflow:hidden;background:#000;margin:0 auto;box-shadow:0 10px 30px rgba(0,0,0,.3)}',
      '.tmc-video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}',
      '.tmc-social-row{display:flex;gap:14px;justify-content:center;margin:8px 0}',
      '.tmc-social{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.08);color:#fff;text-decoration:none;transition:background .12s}',
      '.tmc-social:hover{background:rgba(255,107,0,.2);color:#FF6B00}',
      '.tmc-social svg{width:16px;height:16px}',
      '.tmc-contact-row{display:flex;gap:10px;justify-content:center;align-items:center;font-size:12px;color:#9CA3AF;font-weight:500;margin:4px 0}',
      '.tmc-support-email,.tmc-support-phone{color:#FF6B00;text-decoration:none;font-weight:600}',
      '.tmc-support-email:hover,.tmc-support-phone:hover{text-decoration:underline}',
      '.tmc-dot{color:#6B7280;font-weight:700}'
    ].join('\n');
    document.head.appendChild(st);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { injectCss(); fetchAndRender(); });
  } else {
    injectCss();
    fetchAndRender();
  }

  // Expose for admin live-preview if needed
  window.__tmcRenderSettings = renderAll;
})();
