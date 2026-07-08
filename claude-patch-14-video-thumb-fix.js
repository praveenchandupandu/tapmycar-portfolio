#!/usr/bin/env node
/* ============================================================================
 * claude-patch-14-video-thumb-fix.js
 * ----------------------------------------------------------------------------
 * Fixes the admin Videos uploader (public/cmshaveaccesstouser2026-npmevy.html).
 *
 * BUG: the new-video path hard-throws "Could not read a thumbnail" whenever the
 * browser can't auto-extract a first frame, and the manual-thumbnail override
 * (hooking window.extractThumb) never applies because the upload calls a local
 * extractThumb. Result: your chosen thumbnail is ignored and upload is blocked.
 *
 * FIX: prefer a manually chosen thumbnail directly; else try auto-extract; if
 * neither works, upload the video WITHOUT a thumbnail instead of blocking.
 * Also derives the right extension (jpg/png/webp) for manual thumbnails.
 *
 * SCOPE: admin HTML only (mirrored to root copy if present). Static -> git push.
 * SAFE: byte-preserving (latin1 + ASCII-only insert), idempotent, single-match
 * anchor or it aborts with no change.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const PUB = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');
const ROOT = 'cmshaveaccesstouser2026-npmevy.html';
const MARKER = '__tmcThumbFix';

const RE = /\/\* __tmcThumbRequired:[\s\S]*?var thumbExt = thumbBlob \? 'jpg' : null;/;

const NEW = `/* __tmcThumbFix: use a manually chosen thumbnail if present; else try to
       auto-extract from the first frame; if neither works, upload WITHOUT a
       thumbnail instead of blocking. */
    var _manualThumb = null;
    try { _manualThumb = (document.getElementById('vid-thumb-file').files || [])[0] || null; } catch (e) { _manualThumb = null; }
    var thumbBlob = _manualThumb;
    if (!thumbBlob) {
      try { thumbBlob = await extractThumb(file); } catch (e) { thumbBlob = null; }
    }
    var thumbExt = null;
    if (thumbBlob) {
      thumbExt = 'jpg';
      if (_manualThumb && _manualThumb.name && _manualThumb.name.indexOf('.') !== -1) {
        var _me = _manualThumb.name.split('.').pop().toLowerCase();
        if (_me === 'jpeg') _me = 'jpg';
        if (['jpg', 'png', 'webp'].indexOf(_me) !== -1) thumbExt = _me;
      }
    }`;

function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

console.log('claude-patch-14-video-thumb-fix.js');
console.log('----------------------------------');
if (!fs.existsSync(PUB)) { console.log('ABORT - ' + PUB + ' not found.'); process.exit(1); }

const original = fs.readFileSync(PUB, 'latin1');
if (original.indexOf(MARKER) !== -1) { console.log(PUB + ': video-thumb fix already applied (skip).'); process.exit(0); }

const m = original.match(new RegExp(RE, 'g'));
const cnt = m ? m.length : 0;
if (cnt !== 1) { console.log('ABORT - thumbnail block matched ' + cnt + ' (expected 1). No change.'); process.exit(1); }

const b = PUB + '.bak-' + stamp();
fs.copyFileSync(PUB, b);
try {
  const updated = original.replace(RE, NEW);
  if (updated.indexOf(MARKER) === -1) throw new Error('marker missing after edit');
  if (updated.indexOf('Could not read a thumbnail from this video') !== -1) throw new Error('old throw still present');
  fs.writeFileSync(PUB, Buffer.from(updated, 'latin1'));
  let extra = '';
  if (fs.existsSync(ROOT)) { const rb = ROOT + '.bak-' + stamp(); fs.copyFileSync(ROOT, rb); fs.copyFileSync(PUB, ROOT); extra = ' -> mirrored to root'; }
  console.log(PUB + ': uploader fixed.' + extra + '  (backup: ' + path.basename(b) + ')');
} catch (e) {
  fs.copyFileSync(b, PUB);
  console.log(PUB + ': FAILED -> restored (' + String(e.message || e) + ').');
  process.exit(1);
}
console.log('----------------------------------');
console.log('Deploy: git add -A && commit && push. Then HARD-REFRESH the admin page (Ctrl+Shift+R).');
process.exit(0);
