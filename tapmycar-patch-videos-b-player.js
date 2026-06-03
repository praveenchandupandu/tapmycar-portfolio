/* ============================================================================
 * TapMyCar  Patch Videos-B  reels player + dashboard/landing integration
 * Run from project root:  node tapmycar-patch-videos-b-player.js
 *
 * Adds public/tmc-reels.js (the self-contained reels player) and wires it
 * into dashboard.html (above Recent Activity) and landing.html (Demos after
 * "How it works", Reviews after Pricing).
 *
 * Empty sections auto-hide when no videos exist  safe to deploy now and
 * upload videos later via the admin tab (Patch Videos-C).
 *
 * SAFE TO RE-RUN.
 * ==========================================================================*/
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-videos-b-' + STAMP;
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const REELS_JS = "// TMC_VIDEOS_REELS  inline+expand reels player. Self-contained.\n// Drop two anchor divs into a page:\n//   <div data-tmc-reel=\"demo\"></div>\n//   <div data-tmc-reel=\"review\"></div>\n// Then include this script once. The script will populate each anchor with\n// a horizontal-scrolling row of thumbnails, and mount a shared full-screen\n// player overlay that expands on tap.\n(function () {\n  if (window.__tmcReelsInit) return;\n  window.__tmcReelsInit = true;\n\n  var STYLE = '\\\n.tmc-r-sec-head{display:flex;align-items:center;justify-content:space-between;padding:4px 0 8px}\\\n.tmc-r-sec-title{font-size:15px;font-weight:800;color:#111;letter-spacing:-.2px}\\\n.tmc-r-row{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch}\\\n.tmc-r-row::-webkit-scrollbar{display:none}.tmc-r-row{scrollbar-width:none}\\\n.tmc-r-thumb{flex:0 0 auto;width:118px;height:210px;border-radius:14px;position:relative;overflow:hidden;cursor:pointer;background:#222}\\\n.tmc-r-thumb img,.tmc-r-thumb video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}\\\n.tmc-r-thumb-overlay{position:absolute;inset:0;background:linear-gradient(180deg,transparent 50%,rgba(0,0,0,.55) 100%)}\\\n.tmc-r-thumb-play{position:absolute;top:10px;left:10px;width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}\\\n.tmc-r-thumb-cap{position:absolute;left:8px;right:8px;bottom:8px;color:#fff;font-size:11px;font-weight:600;line-height:1.3}\\\n.tmc-r-thumb-name{color:#fff;font-size:10px;opacity:.85;margin-top:2px;font-weight:500}\\\n.tmc-r-empty{padding:18px;font-size:13px;color:#9CA3AF;text-align:center;border:1px dashed #E5E7EB;border-radius:14px}\\\n.tmc-r-overlay{position:fixed;inset:0;background:#000;z-index:9999;display:none;flex-direction:column}\\\n.tmc-r-overlay.on{display:flex}\\\n.tmc-r-stage{flex:1;position:relative;overflow:hidden;max-width:480px;margin:0 auto;width:100%}\\\n.tmc-r-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000}\\\n.tmc-r-close{position:absolute;top:14px;left:14px;width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:#fff;cursor:pointer;z-index:3}\\\n.tmc-r-prog{position:absolute;top:14px;right:14px;display:flex;gap:3px;z-index:3}\\\n.tmc-r-prog span{width:12px;height:3px;background:rgba(255,255,255,.3);border-radius:2px}\\\n.tmc-r-prog span.on{background:#fff}\\\n.tmc-r-tag{position:absolute;top:60px;left:0;right:0;text-align:center;color:#fff;font-size:11px;font-weight:600;letter-spacing:1px;opacity:.7;z-index:3}\\\n.tmc-r-meta{position:absolute;left:16px;right:80px;bottom:96px;color:#fff;z-index:3}\\\n.tmc-r-creator{display:flex;align-items:center;gap:9px;margin-bottom:10px}\\\n.tmc-r-pic{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#fff}\\\n.tmc-r-cname{font-size:14px;font-weight:700}.tmc-r-csub{font-size:11px;opacity:.7}\\\n.tmc-r-cap{font-size:13px;line-height:1.45;max-width:260px}\\\n.tmc-r-acts{position:absolute;right:14px;bottom:96px;display:flex;flex-direction:column;align-items:center;gap:18px;z-index:3}\\\n.tmc-r-act{display:flex;flex-direction:column;align-items:center;gap:3px;color:#fff;cursor:pointer}\\\n.tmc-r-act-icon{width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center}\\\n.tmc-r-act-label{font-size:11px;font-weight:600}\\\n.tmc-r-cta{position:absolute;left:14px;right:14px;bottom:24px;background:#FF6B00;color:#fff;padding:13px;border-radius:14px;text-align:center;font-size:14px;font-weight:700;z-index:3;cursor:pointer;text-decoration:none;display:block}\\\n.tmc-r-cta.rev{background:#fff;color:#111}\\\n.tmc-r-hint{position:absolute;bottom:72px;left:0;right:0;text-align:center;color:#fff;font-size:10px;opacity:.6;z-index:3}\\\n.tmc-r-mute{position:absolute;top:14px;left:60px;width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:#fff;cursor:pointer;z-index:3}\\\n';\n\n  var s = document.createElement('style');\n  s.textContent = STYLE;\n  document.head.appendChild(s);\n\n  var overlay = document.createElement('div');\n  overlay.className = 'tmc-r-overlay';\n  overlay.innerHTML = '\\\n<div class=\"tmc-r-stage\">\\\n  <video class=\"tmc-r-video\" id=\"tmc-r-video\" playsinline webkit-playsinline muted></video>\\\n  <div class=\"tmc-r-close\" id=\"tmc-r-close\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\"><line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/></svg></div>\\\n  <div class=\"tmc-r-mute\" id=\"tmc-r-mute\"><svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polygon points=\"11 5 6 9 2 9 2 15 6 15 11 19 11 5\"/><line x1=\"23\" y1=\"9\" x2=\"17\" y2=\"15\"/><line x1=\"17\" y1=\"9\" x2=\"23\" y2=\"15\"/></svg></div>\\\n  <div class=\"tmc-r-prog\" id=\"tmc-r-prog\"></div>\\\n  <div class=\"tmc-r-tag\" id=\"tmc-r-tag\"></div>\\\n  <div class=\"tmc-r-meta\">\\\n    <div class=\"tmc-r-creator\"><div class=\"tmc-r-pic\" id=\"tmc-r-pic\">T</div><div><div class=\"tmc-r-cname\" id=\"tmc-r-cname\"></div><div class=\"tmc-r-csub\" id=\"tmc-r-csub\"></div></div></div>\\\n    <div class=\"tmc-r-cap\" id=\"tmc-r-cap\"></div>\\\n  </div>\\\n  <div class=\"tmc-r-acts\">\\\n    <div class=\"tmc-r-act\" id=\"tmc-r-like\"><div class=\"tmc-r-act-icon\"><svg viewBox=\"0 0 24 24\" width=\"20\" height=\"20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z\"/></svg></div><div class=\"tmc-r-act-label\" id=\"tmc-r-like-count\">0</div></div>\\\n    <div class=\"tmc-r-act\" id=\"tmc-r-share\"><div class=\"tmc-r-act-icon\"><svg viewBox=\"0 0 24 24\" width=\"20\" height=\"20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8\"/><polyline points=\"16 6 12 2 8 6\"/><line x1=\"12\" y1=\"2\" x2=\"12\" y2=\"15\"/></svg></div><div class=\"tmc-r-act-label\">Share</div></div>\\\n  </div>\\\n  <div class=\"tmc-r-hint\">Tap video to advance  ·  Swipe up for next</div>\\\n  <a class=\"tmc-r-cta\" id=\"tmc-r-cta\" href=\"#\"></a>\\\n</div>';\n  document.body.appendChild(overlay);\n\n  var videoEl = overlay.querySelector('#tmc-r-video');\n  var muteBtn = overlay.querySelector('#tmc-r-mute');\n  var picEl   = overlay.querySelector('#tmc-r-pic');\n  var cNameEl = overlay.querySelector('#tmc-r-cname');\n  var cSubEl  = overlay.querySelector('#tmc-r-csub');\n  var capEl   = overlay.querySelector('#tmc-r-cap');\n  var tagEl   = overlay.querySelector('#tmc-r-tag');\n  var ctaEl   = overlay.querySelector('#tmc-r-cta');\n  var progEl  = overlay.querySelector('#tmc-r-prog');\n  var likeEl  = overlay.querySelector('#tmc-r-like-count');\n\n  var activeList = [];\n  var activeKind = 'demo';\n  var cur = 0;\n\n  function render() {\n    var v = activeList[cur]; if (!v) return;\n    videoEl.src = v.video_url;\n    videoEl.muted = true;\n    muteBtn.style.display = '';\n    var p = videoEl.play(); if (p && p.catch) p.catch(function () {});\n    picEl.textContent  = v.poster_initial || 'T';\n    picEl.style.background = v.poster_color || '#FF6B00';\n    cNameEl.textContent = v.creator_name || 'TapMyCar';\n    cSubEl.textContent  = v.creator_sub  || '';\n    capEl.textContent   = v.caption || v.title || '';\n    tagEl.textContent   = activeKind === 'demo' ? 'TAPMYCAR DEMOS' : 'CUSTOMER REVIEWS';\n    likeEl.textContent  = String(v.likes || 0);\n    if (v.cta_label && v.cta_href) {\n      ctaEl.textContent = v.cta_label + '  \\u2192';\n      ctaEl.href = v.cta_href;\n      ctaEl.className = 'tmc-r-cta' + (activeKind === 'review' ? ' rev' : '');\n      ctaEl.style.display = '';\n    } else {\n      ctaEl.style.display = 'none';\n    }\n    progEl.innerHTML = activeList.map(function (_, i) { return '<span class=\"' + (i === cur ? 'on' : '') + '\"></span>'; }).join('');\n  }\n  function open(kind, list, idx) {\n    activeKind = kind; activeList = list; cur = idx || 0;\n    overlay.classList.add('on'); document.body.style.overflow = 'hidden';\n    render();\n  }\n  function close() {\n    overlay.classList.remove('on'); document.body.style.overflow = '';\n    try { videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load(); } catch (e) {}\n  }\n  function next() { cur = (cur + 1) % activeList.length; render(); }\n\n  overlay.querySelector('#tmc-r-close').addEventListener('click', close);\n  videoEl.addEventListener('click', next);\n  videoEl.addEventListener('ended', next);\n  muteBtn.addEventListener('click', function (e) {\n    e.stopPropagation();\n    videoEl.muted = !videoEl.muted;\n  });\n  document.addEventListener('keydown', function (e) {\n    if (!overlay.classList.contains('on')) return;\n    if (e.key === 'Escape') close();\n    else if (e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); next(); }\n  });\n  var touchStartY = null;\n  overlay.addEventListener('touchstart', function (e) { touchStartY = e.touches[0].clientY; });\n  overlay.addEventListener('touchend', function (e) {\n    if (touchStartY === null) return;\n    var dy = e.changedTouches[0].clientY - touchStartY;\n    touchStartY = null;\n    if (dy < -60) next();\n    else if (dy > 100) close();\n  });\n\n  function thumbHtml(v, kind) {\n    var thumb = v.thumbnail_url ? ('<img loading=\"lazy\" src=\"' + v.thumbnail_url + '\" alt=\"\">') :\n      ('<div style=\"position:absolute;inset:0;background:' + (v.poster_color || '#FF6B00') + '\"></div>');\n    var play = '<svg viewBox=\"0 0 24 24\" width=\"12\" height=\"12\" fill=\"#fff\"><polygon points=\"6,4 20,12 6,20\"/></svg>';\n    var nameLine = kind === 'review' && v.creator_name ? '<div class=\"tmc-r-thumb-name\">\\u2014 ' + esc(v.creator_name) + '</div>' : '';\n    return '<div class=\"tmc-r-thumb\" data-id=\"' + v.id + '\">' +\n      thumb + '<div class=\"tmc-r-thumb-overlay\"></div>' +\n      '<div class=\"tmc-r-thumb-play\">' + play + '</div>' +\n      '<div class=\"tmc-r-thumb-cap\">' + esc(v.title) + nameLine + '</div>' +\n    '</div>';\n  }\n  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }\n\n  function mountSection(anchor, kind, label) {\n    fetch('/api/get-videos?kind=' + kind).then(function (r) { return r.json(); }).then(function (d) {\n      var list = (d && d.videos) || [];\n      if (!list.length) { anchor.style.display = 'none'; return; }\n      anchor.innerHTML = '<div class=\"tmc-r-sec-head\"><div class=\"tmc-r-sec-title\">' + label + '</div></div><div class=\"tmc-r-row\"></div>';\n      var row = anchor.querySelector('.tmc-r-row');\n      row.innerHTML = list.map(function (v) { return thumbHtml(v, kind); }).join('');\n      row.querySelectorAll('.tmc-r-thumb').forEach(function (el) {\n        el.addEventListener('click', function () {\n          var idx = list.findIndex(function (x) { return x.id === el.dataset.id; });\n          open(kind, list, idx < 0 ? 0 : idx);\n        });\n      });\n    }).catch(function () { anchor.style.display = 'none'; });\n  }\n\n  document.querySelectorAll('[data-tmc-reel]').forEach(function (el) {\n    var kind = el.dataset.tmcReel;\n    var label = el.dataset.tmcLabel || (kind === 'demo' ? 'Demo videos' : 'Customer reviews');\n    if (['demo','review'].includes(kind)) mountSection(el, kind, label);\n  });\n})();\n";

// Write player
const playerPath = path.join('public', 'tmc-reels.js');
if (fs.existsSync(playerPath)) {
  fs.mkdirSync(path.join(BACKUP_DIR, 'public'), { recursive: true });
  fs.copyFileSync(playerPath, path.join(BACKUP_DIR, playerPath));
}
fs.writeFileSync(playerPath, REELS_JS, 'utf8');
execSync('node --check "' + playerPath + '"', { stdio: 'pipe' });
console.log(playerPath + ': written, node --check OK');

function patchFile(p, fn) {
  const raw = fs.readFileSync(p, 'utf8');
  const wasCRLF = raw.indexOf('\r\n') !== -1;
  let text = raw.replace(/\r\n/g, '\n');
  const after = fn(text);
  if (after === null) { console.log(p + ': skip (already patched)'); return; }
  const out = wasCRLF ? after.replace(/\n/g, '\r\n') : after;
  fs.mkdirSync(path.join(BACKUP_DIR, path.dirname(p)), { recursive: true });
  fs.copyFileSync(p, path.join(BACKUP_DIR, p));
  fs.writeFileSync(p, out, 'utf8');
  console.log(p + ': patched');
}

// dashboard.html
patchFile(path.join('public', 'dashboard.html'), function (text) {
  if (text.indexOf('data-tmc-reel="demo"') !== -1) return null;
  const anchor = '    <!-- 6. RECENT ACTIVITY -->';
  if (text.split(anchor).length - 1 !== 1) throw new Error('dashboard anchor not unique');
  const insert = '    <!-- TMC_VIDEOS reels (Patch Videos B) -->\n' +
    '    <div data-tmc-reel="demo"  data-tmc-label="Demo videos"      style="margin-bottom:18px"></div>\n' +
    '    <div data-tmc-reel="review" data-tmc-label="Customer reviews" style="margin-bottom:18px"></div>\n\n';
  text = text.replace(anchor, insert + anchor);
  if (text.indexOf('/tmc-reels.js') === -1) {
    if (text.indexOf('</body>') !== -1) text = text.replace('</body>', '<script src="/tmc-reels.js"></script>\n</body>');
    else text += '\n<script src="/tmc-reels.js"></script>\n';
  }
  return text;
});

// landing.html
patchFile(path.join('public', 'landing.html'), function (text) {
  if (text.indexOf('data-tmc-reel="demo"') !== -1) return null;
  const pricingAnchor = '<div class="section">\n  <div class="section-label">Pricing</div>';
  if (text.split(pricingAnchor).length - 1 !== 1) throw new Error('landing pricing anchor not unique');
  const demoBlock = '<div class="section" style="background:#F9FAFB;padding:36px 24px">\n  <div class="section-label">See it in action</div>\n  <h2 style="margin-bottom:20px">Watch how TapMyCar works.</h2>\n  <div data-tmc-reel="demo" data-tmc-label=""></div>\n</div>\n\n<div class="chev"></div>\n\n<div class="section">\n  <div class="section-label">Pricing</div>';
  text = text.replace(pricingAnchor, demoBlock);

  const reviewAnchor = '<div class="section" style="background:#F9FAFB">\n  <div class="section-label">Early users</div>';
  if (text.split(reviewAnchor).length - 1 !== 1) throw new Error('landing review anchor not unique');
  const reviewBlock = '<div class="section" style="background:#fff;padding:36px 24px">\n  <div class="section-label">Real customers</div>\n  <h2 style="margin-bottom:20px">Hear it from people using TapMyCar.</h2>\n  <div data-tmc-reel="review" data-tmc-label=""></div>\n</div>\n\n<div class="tape"></div>\n\n<div class="section" style="background:#F9FAFB">\n  <div class="section-label">Early users</div>';
  text = text.replace(reviewAnchor, reviewBlock);

  if (text.indexOf('/tmc-reels.js') === -1) {
    if (text.indexOf('</body>') !== -1) text = text.replace('</body>', '<script src="/tmc-reels.js"></script>\n</body>');
    else text += '\n<script src="/tmc-reels.js"></script>\n';
  }
  return text;
});

console.log('\nDone.');
console.log('\nNEXT STEPS:');
console.log('  1. git add -A');
console.log('  2. git commit -m "Patch Videos B: reels player + dashboard/landing"');
console.log('  3. git push');
console.log('\nReels sections will auto-hide on dashboard + landing until you');
console.log('upload videos via the admin Videos tab (Patch Videos-C).');
