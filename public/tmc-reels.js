// TMC_VIDEOS_REELS v2  inline+expand reels player with real share.
(function () {
  if (window.__tmcReelsInit) return;
  window.__tmcReelsInit = true;

  var STYLE = '\
.tmc-r-sec-head{display:flex;align-items:center;justify-content:space-between;padding:4px 0 8px}\
.tmc-r-sec-title{font-size:15px;font-weight:800;color:#111;letter-spacing:-.2px}\
.tmc-r-row{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch}\
.tmc-r-row::-webkit-scrollbar{display:none}.tmc-r-row{scrollbar-width:none}\
.tmc-r-thumb{flex:0 0 auto;width:118px;height:210px;border-radius:14px;position:relative;overflow:hidden;cursor:pointer;background:#222}\
.tmc-r-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}\
.tmc-r-thumb-overlay{position:absolute;inset:0;background:linear-gradient(180deg,transparent 50%,rgba(0,0,0,.55) 100%)}\
.tmc-r-thumb-play{position:absolute;top:10px;left:10px;width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}\
.tmc-r-thumb-cap{position:absolute;left:8px;right:8px;bottom:8px;color:#fff;font-size:11px;font-weight:600;line-height:1.3}\
.tmc-r-thumb-name{color:#fff;font-size:10px;opacity:.85;margin-top:2px;font-weight:500}\
.tmc-r-overlay{position:fixed;inset:0;background:#000;z-index:9999;display:none;flex-direction:column}\
.tmc-r-overlay.on{display:flex}\
.tmc-r-stage{flex:1;position:relative;overflow:hidden;max-width:480px;margin:0 auto;width:100%;background:#000}\
.tmc-r-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000;cursor:pointer}\
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
    var thumb = v.thumbnail_url ? ('<img loading="lazy" src="' + v.thumbnail_url + '" alt="">') :
      ('<div style="position:absolute;inset:0;background:' + (v.poster_color || '#FF6B00') + '"></div>');
    var play = '<svg viewBox="0 0 24 24" width="12" height="12" fill="#fff"><polygon points="6,4 20,12 6,20"/></svg>';
    var nameLine = kind === 'review' && v.creator_name ? '<div class="tmc-r-thumb-name">\u2014 ' + esc(v.creator_name) + '</div>' : '';
    return '<div class="tmc-r-thumb" data-id="' + v.id + '">' +
      thumb + '<div class="tmc-r-thumb-overlay"></div>' +
      '<div class="tmc-r-thumb-play">' + play + '</div>' +
      '<div class="tmc-r-thumb-cap">' + esc(v.title) + nameLine + '</div>' +
    '</div>';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function mountSection(anchor, kind, label) {
    fetch('/api/get-videos?kind=' + kind).then(function (r) { return r.json(); }).then(function (d) {
      var list = (d && d.videos) || [];
      if (!list.length) { anchor.style.display = 'none'; return; }
      anchor.innerHTML = '<div class="tmc-r-sec-head"><div class="tmc-r-sec-title">' + label + '</div></div><div class="tmc-r-row"></div>';
      var row = anchor.querySelector('.tmc-r-row');
      row.innerHTML = list.map(function (v) { return thumbHtml(v, kind); }).join('');
      row.querySelectorAll('.tmc-r-thumb').forEach(function (el) {
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
    if (['demo','review'].includes(kind)) mountSection(el, kind, label);
  });
})();
