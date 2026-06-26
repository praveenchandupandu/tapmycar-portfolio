// TMC_REEL_SUBLABEL: data-tmc-sublabel support added
// TMC_VIDEOS_REELS v2  inline+expand reels player with real share.
(function () {
  if (window.__tmcReelsInit) return;
  window.__tmcReelsInit = true;

  var STYLE = '\
.tmc-r-sec-head{display:flex;align-items:center;justify-content:space-between;padding:4px 0 8px}\
.tmc-r-sec-title{font-size:16px;font-weight:800;color:#111;letter-spacing:-.3px}\
.tmc-r-sec-sublabel{font-size:12px;color:#6B7280;margin-top:2px;font-weight:500}\
.tmc-r-sec.dark .tmc-r-sec-sublabel{color:#9CA3AF}\
.tmc-r-sec.dark .tmc-r-sec-title{color:#fff}\
.tmc-r-sec.dark{background:#0B0B0F;border-radius:18px;padding:18px 12px 22px;margin:0 -6px 18px}\
.tmc-r-sec.dark .tmc-r-sec-head{padding-left:6px;padding-right:6px}\
.tmc-r-row{display:flex;gap:12px;overflow-x:auto;padding:6px 2px 14px;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory}\
.tmc-r-row::-webkit-scrollbar{display:none}.tmc-r-row{scrollbar-width:none}\
\
/* DEMO  cinematic */\
.tmc-r-thumb{flex:0 0 auto;width:168px;height:280px;border-radius:18px;position:relative;overflow:hidden;cursor:pointer;box-shadow:0 12px 28px rgba(0,0,0,.18),0 2px 6px rgba(0,0,0,.12);scroll-snap-align:start;transition:transform .35s cubic-bezier(.2,.8,.2,1),box-shadow .35s ease;background:#222}\
.tmc-r-thumb:hover{transform:translateY(-6px) scale(1.04);box-shadow:0 22px 44px rgba(255,107,0,.3),0 4px 10px rgba(0,0,0,.15)}\
.tmc-r-thumb img,.tmc-r-thumb .tmc-r-bg{position:absolute;inset:-10%;width:120%;height:120%;object-fit:cover;animation:tmcBgDrift 14s ease-in-out infinite alternate;will-change:transform}\
.tmc-r-thumb:nth-child(2) img,.tmc-r-thumb:nth-child(2) .tmc-r-bg{animation-delay:-2s}\
.tmc-r-thumb:nth-child(3) img,.tmc-r-thumb:nth-child(3) .tmc-r-bg{animation-delay:-5s}\
.tmc-r-thumb:nth-child(4) img,.tmc-r-thumb:nth-child(4) .tmc-r-bg{animation-delay:-8s}\
.tmc-r-thumb:nth-child(5) img,.tmc-r-thumb:nth-child(5) .tmc-r-bg{animation-delay:-11s}\
@keyframes tmcBgDrift{from{transform:scale(1.08) translate(-1%,-2%)}to{transform:scale(1.18) translate(2%,2%)}}\
.tmc-r-thumb-grad{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.18) 40%,rgba(0,0,0,.88) 100%)}\
.tmc-r-thumb-shine{position:absolute;inset:0;background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.22) 48%,transparent 65%);transform:translateX(-150%);transition:transform .8s cubic-bezier(.2,.8,.2,1);pointer-events:none}\
.tmc-r-thumb:hover .tmc-r-thumb-shine{transform:translateX(150%)}\
.tmc-r-thumb-badge{position:absolute;top:12px;left:12px;background:rgba(255,255,255,.16);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);color:#fff;font-size:9px;font-weight:800;letter-spacing:1.2px;padding:5px 10px;border-radius:6px;text-transform:uppercase;border:.5px solid rgba(255,255,255,.22)}\
.tmc-r-thumb-badge.feat{background:linear-gradient(135deg,#FF6B00,#FF9540);border:none;box-shadow:0 4px 10px rgba(255,107,0,.4)}\
.tmc-r-thumb-play{position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,.5);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);display:flex;align-items:center;justify-content:center;border:.5px solid rgba(255,255,255,.22);transition:transform .25s ease,background .25s ease}\
.tmc-r-thumb:hover .tmc-r-thumb-play{background:#FF6B00;transform:scale(1.12);border-color:transparent}\
.tmc-r-thumb-cap{position:absolute;left:14px;right:14px;bottom:14px;color:#fff;transition:transform .35s cubic-bezier(.2,.8,.2,1)}\
.tmc-r-thumb:hover .tmc-r-thumb-cap{transform:translateY(-2px)}\
.tmc-r-thumb-title{font-size:14px;font-weight:800;line-height:1.25;margin-bottom:4px;text-shadow:0 2px 8px rgba(0,0,0,.55);letter-spacing:-.2px}\
.tmc-r-thumb-meta{font-size:10px;opacity:.85;font-weight:600;letter-spacing:.3px;display:flex;align-items:center;gap:6px}\
.tmc-r-thumb-dot{width:3px;height:3px;background:rgba(255,255,255,.7);border-radius:50%}\
.tmc-r-thumb-live{width:6px;height:6px;background:#FF3B30;border-radius:50%;box-shadow:0 0 8px #FF3B30;animation:tmcPulse 2s ease-in-out infinite}\
@keyframes tmcPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.8)}}\
\
/* REVIEW  hybrid wide card */\
.tmc-rv{flex:0 0 auto;width:340px;height:208px;border-radius:20px;position:relative;overflow:hidden;cursor:pointer;box-shadow:0 18px 38px rgba(0,0,0,.35),0 4px 10px rgba(0,0,0,.15);scroll-snap-align:start;background:#0B0B0F;display:flex;transition:transform .35s cubic-bezier(.2,.8,.2,1),box-shadow .35s ease}\
.tmc-rv:hover{transform:translateY(-4px);box-shadow:0 24px 50px rgba(255,107,0,.22),0 6px 14px rgba(0,0,0,.18)}\
.tmc-rv-vid{width:118px;flex:0 0 118px;position:relative;overflow:hidden}\
.tmc-rv-vid img,.tmc-rv-vid .tmc-r-bg{position:absolute;inset:-10%;width:120%;height:120%;object-fit:cover;animation:tmcBgDrift 16s ease-in-out infinite alternate;will-change:transform}\
.tmc-rv:nth-child(2) .tmc-rv-vid img,.tmc-rv:nth-child(2) .tmc-rv-vid .tmc-r-bg{animation-delay:-3s}\
.tmc-rv:nth-child(3) .tmc-rv-vid img,.tmc-rv:nth-child(3) .tmc-rv-vid .tmc-r-bg{animation-delay:-6s}\
.tmc-rv:nth-child(4) .tmc-rv-vid img,.tmc-rv:nth-child(4) .tmc-rv-vid .tmc-r-bg{animation-delay:-9s}\
.tmc-rv-grad{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,0) 30%,rgba(11,11,15,.65) 80%,#0B0B0F 100%)}\
.tmc-rv-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(1);width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,.92);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 18px rgba(0,0,0,.4);transition:transform .25s ease,background .25s ease}\
.tmc-rv:hover .tmc-rv-play{transform:translate(-50%,-50%) scale(1.12);background:#FF6B00}\
.tmc-rv:hover .tmc-rv-play svg polygon{fill:#fff}\
.tmc-rv-tag{position:absolute;bottom:10px;left:10px;background:rgba(0,0,0,.55);backdrop-filter:blur(10px);color:#fff;font-size:9px;font-weight:700;padding:3px 7px;border-radius:5px;letter-spacing:.3px}\
.tmc-rv-content{flex:1;padding:14px 16px 14px 12px;display:flex;flex-direction:column;color:#fff;min-width:0;position:relative}\
.tmc-rv-quote-mark{position:absolute;top:4px;right:12px;font-family:Georgia,serif;font-size:52px;font-style:italic;color:#FF6B00;opacity:.22;line-height:1;pointer-events:none;user-select:none}\
.tmc-rv-creator{display:flex;align-items:center;gap:9px;margin-bottom:8px;position:relative;z-index:1}\
.tmc-rv-avatar{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#FF6B00,#FF9540);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;color:#fff;flex:0 0 30px;box-shadow:0 2px 8px rgba(255,107,0,.4)}\
.tmc-rv-info{min-width:0;flex:1}\
.tmc-rv-name{font-size:12px;font-weight:700;line-height:1.1;display:flex;align-items:center;gap:4px}\
.tmc-rv-verified{color:#FF6B00;display:inline-flex}\
.tmc-rv-sub{font-size:10px;opacity:.55;line-height:1.3;margin-top:1px}\
.tmc-rv-stars{display:flex;gap:1px;margin-top:3px}\
.tmc-rv-stars svg{width:9px;height:9px;fill:#FBBF24}\
.tmc-rv-quote{font-size:12.5px;font-weight:600;line-height:1.4;letter-spacing:-.1px;margin-bottom:6px;position:relative;z-index:1;flex:1;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}\
.tmc-rv-actions{display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1;margin-top:auto}\
.tmc-rv-act-group{display:flex;gap:12px}\
.tmc-rv-act{display:flex;align-items:center;gap:4px;color:rgba(255,255,255,.7);font-size:10px;font-weight:600}\
.tmc-rv-cta{background:#FF6B00;color:#fff;font-size:10px;font-weight:700;padding:6px 10px;border-radius:7px;display:inline-flex;align-items:center;gap:4px;transition:transform .2s ease,background .2s ease}\
.tmc-rv:hover .tmc-rv-cta{transform:translateX(2px);background:#FF8420}\
\
.tmc-r-overlay{position:fixed;inset:0;background:#000;z-index:9999;display:none;flex-direction:column}\
.tmc-r-overlay.on{display:flex}\
.tmc-r-stage{flex:1;position:relative;overflow:hidden;max-width:480px;margin:0 auto;width:100%;background:#000}\
.tmc-r-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000;cursor:pointer;display:block}\
.tmc-r-close{position:absolute;top:14px;left:14px;width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:#fff;cursor:pointer;z-index:3}\
.tmc-r-prog{position:absolute;top:14px;right:14px;display:flex;gap:3px;z-index:3}\
.tmc-r-prog span{width:12px;height:3px;background:rgba(255,255,255,.3);border-radius:2px}\
.tmc-r-prog span.on{background:#fff}\
.tmc-r-tag{position:absolute;top:60px;left:0;right:0;text-align:center;color:#fff;font-size:11px;font-weight:600;letter-spacing:1px;opacity:.7;z-index:3;pointer-events:none}\
.tmc-r-meta{position:absolute;left:16px;right:80px;bottom:96px;color:#fff;z-index:3;pointer-events:none}\
.tmc-r-creator{display:flex;align-items:center;gap:9px;margin-bottom:10px}\
.tmc-r-pic{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#fff}\
.tmc-r-cname{font-size:14px;font-weight:700}.tmc-r-csub{font-size:11px;opacity:.7}\
.tmc-r-cap{font-size:13px;line-height:1.45;max-width:260px}\
.tmc-r-acts{position:absolute;right:14px;bottom:96px;display:flex;flex-direction:column;align-items:center;gap:18px;z-index:3}\
.tmc-r-act{display:flex;flex-direction:column;align-items:center;gap:3px;color:#fff;cursor:pointer;user-select:none}\
.tmc-r-act-icon{width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;transition:transform .15s ease,background .15s ease}\
.tmc-r-act:active .tmc-r-act-icon{transform:scale(.9)}\
.tmc-r-act.liked .tmc-r-act-icon{background:#FF3B30}\
.tmc-r-act.liked svg{fill:#fff;stroke:#fff}\
.tmc-r-act-label{font-size:11px;font-weight:600}\
.tmc-r-cta{position:absolute;left:14px;right:14px;bottom:24px;background:#FF6B00;color:#fff;padding:13px;border-radius:14px;text-align:center;font-size:14px;font-weight:700;z-index:3;cursor:pointer;text-decoration:none;display:block}\
.tmc-r-cta.rev{background:#fff;color:#111}\
.tmc-r-hint{position:absolute;bottom:72px;left:0;right:0;text-align:center;color:#fff;font-size:10px;opacity:.6;z-index:3;pointer-events:none}\
.tmc-r-toast{position:absolute;left:50%;transform:translateX(-50%);bottom:140px;background:rgba(255,255,255,.95);color:#111;padding:8px 14px;border-radius:20px;font-size:12px;font-weight:600;z-index:4;opacity:0;transition:opacity .2s ease;pointer-events:none}\
.tmc-r-toast.on{opacity:1}\
';

  var s = document.createElement('style');
  s.textContent = STYLE;
  document.head.appendChild(s);

  var overlay = document.createElement('div');
  overlay.className = 'tmc-r-overlay';
  overlay.innerHTML = '\
<div class="tmc-r-stage">\
  <video class="tmc-r-video" id="tmc-r-video" playsinline webkit-playsinline></video>\
  <div class="tmc-r-close" id="tmc-r-close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>\
  <div class="tmc-r-prog" id="tmc-r-prog"></div>\
  <div class="tmc-r-tag" id="tmc-r-tag"></div>\
  <div class="tmc-r-meta">\
    <div class="tmc-r-creator"><div class="tmc-r-pic" id="tmc-r-pic">T</div><div><div class="tmc-r-cname" id="tmc-r-cname"></div><div class="tmc-r-csub" id="tmc-r-csub"></div></div></div>\
    <div class="tmc-r-cap" id="tmc-r-cap"></div>\
  </div>\
  <div class="tmc-r-acts">\
    <div class="tmc-r-act" id="tmc-r-like"><div class="tmc-r-act-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div></div>\
    <div class="tmc-r-act" id="tmc-r-share"><div class="tmc-r-act-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg></div><div class="tmc-r-act-label">Share</div></div>\
  </div>\
  <div class="tmc-r-hint">Tap video to advance  ·  Swipe up for next</div>\
  <a class="tmc-r-cta" id="tmc-r-cta" href="#"></a>\
  <div class="tmc-r-toast" id="tmc-r-toast"></div>\
</div>';
  document.body.appendChild(overlay);

  var videoEl = overlay.querySelector('#tmc-r-video');
  var picEl   = overlay.querySelector('#tmc-r-pic');
  var cNameEl = overlay.querySelector('#tmc-r-cname');
  var cSubEl  = overlay.querySelector('#tmc-r-csub');
  var capEl   = overlay.querySelector('#tmc-r-cap');
  var tagEl   = overlay.querySelector('#tmc-r-tag');
  var ctaEl   = overlay.querySelector('#tmc-r-cta');
  var progEl  = overlay.querySelector('#tmc-r-prog');
  var likeBtn = overlay.querySelector('#tmc-r-like');
  var shareBtn= overlay.querySelector('#tmc-r-share');
  var toastEl = overlay.querySelector('#tmc-r-toast');

  var activeList = [];
  var activeKind = 'demo';
  var cur = 0;
  var likedSet = {};

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove('on'); }, 1200);
  }

  function render() {
    var v = activeList[cur]; if (!v) return;
    videoEl.src = v.video_url;
    videoEl.muted = false;
    var p = videoEl.play();
    if (p && p.catch) {
      p.catch(function () {
        videoEl.muted = true;
        videoEl.play().catch(function () {});
      });
    }
    picEl.textContent  = (v.poster_initial || (v.creator_name || 'T').charAt(0)).toUpperCase();
    picEl.style.background = v.poster_color || '#FF6B00';
    cNameEl.textContent = v.creator_name || 'TapMyCar';
    cSubEl.textContent  = v.creator_sub  || '';
    capEl.textContent   = v.caption || v.title || '';
    tagEl.textContent   = activeKind === 'demo' ? 'TAPMYCAR DEMOS' : 'CUSTOMER REVIEWS';
    if (v.cta_label && v.cta_href) {
      ctaEl.textContent = v.cta_label + '  \u2192';
      ctaEl.href = v.cta_href;
      ctaEl.className = 'tmc-r-cta' + (activeKind === 'review' ? ' rev' : '');
      ctaEl.style.display = '';
    } else {
      ctaEl.style.display = 'none';
    }
    progEl.innerHTML = activeList.map(function (_, i) { return '<span class="' + (i === cur ? 'on' : '') + '"></span>'; }).join('');
    likeBtn.className = 'tmc-r-act' + (likedSet[v.id] ? ' liked' : '');
  }
  function open(kind, list, idx) {
    activeKind = kind; activeList = list; cur = idx || 0;
    overlay.classList.add('on'); document.body.style.overflow = 'hidden';
    render();
  }
  function close() {
    overlay.classList.remove('on'); document.body.style.overflow = '';
    try { videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load(); } catch (e) {}
  }
  function next() { cur = (cur + 1) % activeList.length; render(); }

  overlay.querySelector('#tmc-r-close').addEventListener('click', close);
  videoEl.addEventListener('click', next);
  videoEl.addEventListener('ended', next);

  likeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var v = activeList[cur]; if (!v) return;
    likedSet[v.id] = !likedSet[v.id];
    likeBtn.className = 'tmc-r-act' + (likedSet[v.id] ? ' liked' : '');
    try { localStorage.setItem('tmc_video_likes', JSON.stringify(likedSet)); } catch (x) {}
    if (likedSet[v.id]) toast('Liked');
  });

  shareBtn.addEventListener('click', async function (e) {
    e.stopPropagation();
    var v = activeList[cur]; if (!v) return;
    var url = location.origin + '/v/' + v.id;
    var shareData = {
      title: v.title || 'TapMyCar',
      text: v.caption || v.title || 'Check this out from TapMyCar',
      url: url
    };
    if (navigator.share) {
      try { await navigator.share(shareData); return; } catch (x) { if (x && x.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch (x) {
      window.prompt('Copy this link:', url);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (!overlay.classList.contains('on')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); next(); }
  });
  var touchStartY = null;
  overlay.addEventListener('touchstart', function (e) { touchStartY = e.touches[0].clientY; });
  overlay.addEventListener('touchend', function (e) {
    if (touchStartY === null) return;
    var dy = e.changedTouches[0].clientY - touchStartY;
    touchStartY = null;
    if (dy < -60) next();
    else if (dy > 100) close();
  });

  try { likedSet = JSON.parse(localStorage.getItem('tmc_video_likes') || '{}') || {}; } catch (x) {}

  function thumbHtml(v, kind) {
    var bg = v.thumbnail_url
      ? '<img loading="lazy" src="' + v.thumbnail_url + '" alt="">'
      : '<div class="tmc-r-bg" style="background:' + (v.poster_color || '#FF6B00') + '"></div>';
    var play = '<svg viewBox="0 0 24 24" width="11" height="11" fill="#fff"><polygon points="6,4 20,12 6,20"/></svg>';
    if (kind === 'review') {
      var initial = (v.creator_name || 'T').trim().charAt(0).toUpperCase();
      var stars = '';
      for (var i = 0; i < 5; i++) {
        stars += '<svg viewBox="0 0 24 24"><path d="M12 2L9.5 7.5 4 8l4.5 4-1 6L12 15l4.5 3-1-6L20 8l-5.5-.5z"/></svg>';
      }
      var bgReview = v.thumbnail_url
        ? '<img loading="lazy" src="' + v.thumbnail_url + '" alt="">'
        : '<div class="tmc-r-bg" style="background:' + (v.poster_color || '#FF6B00') + '"></div>';
      var verifiedIcon = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L9.5 7.5 4 8l4.5 4-1 6L12 15l4.5 3-1-6L20 8l-5.5-.5z"/></svg>';
      var ctaIcon = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="9,6 15,12 9,18"/></svg>';
      var heart = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
      var shareIc = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>';
      return '<div class="tmc-rv" data-id="' + v.id + '">' +
        '<div class="tmc-rv-vid">' + bgReview +
          '<div class="tmc-rv-grad"></div>' +
          '<div class="tmc-rv-play">' + play + '</div>' +
        '</div>' +
        '<div class="tmc-rv-content">' +
          '<div class="tmc-rv-quote-mark">\u201C</div>' +
          '<div class="tmc-rv-creator">' +
            '<div class="tmc-rv-avatar">' + esc(initial) + '</div>' +
            '<div class="tmc-rv-info">' +
              '<div class="tmc-rv-name">' + esc(v.creator_name || 'Customer') + '<span class="tmc-rv-verified">' + verifiedIcon + '</span></div>' +
              '<div class="tmc-rv-sub">' + esc(v.creator_sub || 'Verified user') + '</div>' +
              '<div class="tmc-rv-stars">' + stars + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="tmc-rv-quote">' + esc(v.caption || v.title) + '</div>' +
          '<div class="tmc-rv-actions">' +
            '<div class="tmc-rv-act-group">' +
              '<div class="tmc-rv-act">' + heart + 'Like</div>' +
              '<div class="tmc-rv-act">' + shareIc + 'Share</div>' +
            '</div>' +
            '<span class="tmc-rv-cta">Watch' + ctaIcon + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }
    // Demo cinematic card
    var featured = v.featured ? '<div class="tmc-r-thumb-badge feat">Featured</div>' : '';
    var liveDot = v.featured ? '<span class="tmc-r-thumb-live"></span>' : '';
    var views = v.views ? (Math.round((v.views || 0) / 100) / 10).toFixed(1) + 'K' : '';
    var metaParts = [];
    if (views) metaParts.push(views + ' views');
    var metaHtml = '';
    if (metaParts.length) metaHtml = '<div class="tmc-r-thumb-meta">' + liveDot + esc(metaParts.join(' \u00b7 ')) + '</div>';
    return '<div class="tmc-r-thumb" data-id="' + v.id + '">' +
      bg + '<div class="tmc-r-thumb-grad"></div>' +
      '<div class="tmc-r-thumb-shine"></div>' +
      featured +
      '<div class="tmc-r-thumb-play">' + play + '</div>' +
      '<div class="tmc-r-thumb-cap">' +
        '<div class="tmc-r-thumb-title">' + esc(v.title) + '</div>' +
        metaHtml +
      '</div>' +
    '</div>';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function mountSection(anchor, kind, label, sublabel) {
    fetch('/api/get-videos?kind=' + kind).then(function (r) { return r.json(); }).then(function (d) {
      var list = (d && d.videos) || [];
      if (!list.length) { anchor.style.display = 'none'; return; }
      var sectionClass = 'tmc-r-sec';
      anchor.innerHTML = '<div class="' + sectionClass + '">' +
        '<div class="tmc-r-sec-head"><div>' +
          '<div class="tmc-r-sec-title">' + label + '</div>' +
          (sublabel ? '<div class="tmc-r-sec-sublabel">' + esc(sublabel) + '</div>' : '') +
        '</div></div>' +
        '<div class="tmc-r-row"></div>' +
      '</div>';
      var row = anchor.querySelector('.tmc-r-row');
      row.innerHTML = list.map(function (v, i) {
        if (kind === 'demo' && i === 0) v.featured = true;
        return thumbHtml(v, kind);
      }).join('');
      var selector = kind === 'review' ? '.tmc-rv' : '.tmc-r-thumb';
      row.querySelectorAll(selector).forEach(function (el) {
        el.addEventListener('click', function () {
          var idx = list.findIndex(function (x) { return x.id === el.dataset.id; });
          open(kind, list, idx < 0 ? 0 : idx);
        });
      });
    }).catch(function () { anchor.style.display = 'none'; });
  }

  document.querySelectorAll('[data-tmc-reel]').forEach(function (el) {
    var kind = el.dataset.tmcReel;
    var label = el.dataset.tmcLabel || (kind === 'demo' ? 'Demo videos' : 'Customer reviews');
    var sublabel = el.dataset.tmcSublabel || '';
    if (['demo','review'].includes(kind)) mountSection(el, kind, label, sublabel);
  });
})();
