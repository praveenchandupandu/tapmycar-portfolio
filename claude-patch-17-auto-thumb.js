#!/usr/bin/env node
/* ============================================================================
 * claude-patch-17-auto-thumb.js
 * ----------------------------------------------------------------------------
 * Admin dashboard: auto-format ANY uploaded video thumbnail into a full 9:16
 * image with a blurred fill (nothing cropped). Works on new-video uploads and
 * edits, updates the preview, and is a no-op if the image is already 9:16.
 * Falls back to the original file on any error.
 *
 * Adds a client-side helper autoFit916(file) and wires it into:
 *   - uploadManualThumb() (edit path)
 *   - the new-video manual-thumb path
 *   - the thumbnail preview handler
 *
 * SCOPE: public/cmshaveaccesstouser2026-npmevy.html (mirrored to root if present).
 * Static -> git push updates the WEBSITE immediately; the APP reflects it after
 * npx cap sync android + rebuild (bundled JS).
 *
 * SAFE: byte-preserving (latin1 + ASCII inserts), idempotent, each of the 3
 * anchors must match exactly once or it aborts with no change.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const PUB = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');
const ROOT = 'cmshaveaccesstouser2026-npmevy.html';
const MARKER = 'TMC_AUTOFIT916';

const HELPER = `function autoFit916(file) {
  /* ${MARKER}: format a thumbnail to full 9:16 with blurred fill; unchanged if already 9:16; original on error */
  return new Promise(function (resolve) {
    try {
      var img = new Image();
      img.onload = function () {
        var iw = img.naturalWidth, ih = img.naturalHeight;
        if (!iw || !ih) { resolve(file); return; }
        var target = 1080 / 1920;
        if (Math.abs((iw / ih) - target) < 0.02) { resolve(file); return; }
        var TW = 1080, TH = 1920;
        var c = document.createElement('canvas');
        c.width = TW; c.height = TH;
        var ctx = c.getContext('2d');
        var bs = Math.max(TW / iw, TH / ih), bw = iw * bs, bh = ih * bs;
        try { ctx.filter = 'blur(28px)'; } catch (e) {}
        ctx.drawImage(img, (TW - bw) / 2, (TH - bh) / 2, bw, bh);
        try { ctx.filter = 'none'; } catch (e) {}
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, TW, TH);
        var fs = Math.min(TW / iw, TH / ih), fw = iw * fs, fh = ih * fs;
        ctx.drawImage(img, (TW - fw) / 2, (TH - fh) / 2, fw, fh);
        c.toBlob(function (blob) { resolve(blob || file); }, 'image/jpeg', 0.9);
      };
      img.onerror = function () { resolve(file); };
      img.src = URL.createObjectURL(file);
    } catch (e) { resolve(file); }
  });
}

`;

const NEW_UMT = `async function uploadManualThumb() {
  var f = document.getElementById('vid-thumb-file').files[0];
  if (!f) return null;
  var fitted = await autoFit916(f);
  var ext = 'jpg';
  if (fitted === f) {
    ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    if (!['jpg','png','webp'].includes(ext)) ext = 'jpg';
  }
  var prep = await fetch('/api/admin-thumb-prepare-upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thumb_ext: ext })
  });
  var pd = await prep.json();
  if (!prep.ok || !pd.ok) throw new Error(pd.error || 'thumb prepare failed');
  await uploadToSignedUrl(pd.thumb.signed_url, fitted, function () {});
  return pd.thumb.public_url;
}`;

const RE_UMT = /async function uploadManualThumb\(\) \{[\s\S]*?return pd\.thumb\.public_url;\s*\}/;
const RE_PREVIEW = /var img = document\.getElementById\('vid-thumb-preview'\);[\s\S]*?img\.src = URL\.createObjectURL\(f\); img\.style\.display='';/;
const ANCHOR_NEWVID = "var thumbBlob = _manualThumb;";

function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function countRe(s, re) { const m = s.match(new RegExp(re, 'g')); return m ? m.length : 0; }
function countStr(s, sub) { return s.split(sub).length - 1; }

function apply(text) {
  // 1) helper + uploadManualThumb
  text = text.replace(RE_UMT, function () { return HELPER + NEW_UMT; });
  // 2) new-video path: auto-fit the manual thumb
  text = text.replace(ANCHOR_NEWVID, "if (_manualThumb) { try { _manualThumb = await autoFit916(_manualThumb); } catch (e) {} }\n    var thumbBlob = _manualThumb;");
  // 3) preview: show the fitted result
  text = text.replace(RE_PREVIEW, function (m) {
    return m.replace(
      "img.src = URL.createObjectURL(f); img.style.display='';",
      "img.style.display=''; autoFit916(f).then(function(b){ try { img.src = URL.createObjectURL(b); } catch(e){ try{ img.src = URL.createObjectURL(f); }catch(_){}} });"
    );
  });
  return text;
}

function run(file, isRoot) {
  if (!fs.existsSync(file)) return isRoot ? { file, status: 'skip (no root copy)' } : { file, status: 'ABORT - not found' };
  const original = fs.readFileSync(file, 'latin1');
  if (original.indexOf(MARKER) !== -1) return { file, status: 'already applied (skip)' };

  const cUMT = countRe(original, RE_UMT);
  const cNew = countStr(original, ANCHOR_NEWVID);
  const cPrev = countRe(original, RE_PREVIEW);
  if (cUMT !== 1) return { file, status: 'ABORT - uploadManualThumb anchor matched ' + cUMT };
  if (cNew !== 1) return { file, status: 'ABORT - new-video thumb anchor matched ' + cNew };
  if (cPrev !== 1) return { file, status: 'ABORT - preview anchor matched ' + cPrev };

  const updated = apply(original);
  if (updated.indexOf(MARKER) === -1) return { file, status: 'ABORT - marker missing after edit' };

  const b = file + '.bak-' + stamp();
  fs.copyFileSync(file, b);
  fs.writeFileSync(file, Buffer.from(updated, 'latin1'));
  return { file, status: 'auto-thumbnail added', backup: path.basename(b) };
}

console.log('claude-patch-17-auto-thumb.js');
console.log('-----------------------------');
const r1 = run(PUB, false);
console.log(r1.file + ': ' + r1.status + (r1.backup ? '  (backup: ' + r1.backup + ')' : ''));
if (r1.status.indexOf('ABORT') === 0) process.exit(1);
if (r1.status === 'auto-thumbnail added' && fs.existsSync(ROOT)) {
  const rb = ROOT + '.bak-' + stamp();
  fs.copyFileSync(ROOT, rb);
  fs.copyFileSync(PUB, ROOT);
  console.log(ROOT + ': mirrored from public  (backup: ' + path.basename(rb) + ')');
}
console.log('-----------------------------');
console.log('Deploy: git add -A && commit && push. WEBSITE updates now; for the APP: npx cap sync android + rebuild.');
process.exit(0);
