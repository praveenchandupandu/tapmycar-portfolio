#!/usr/bin/env node
/* ============================================================================
 * claude-patch-19-reels-full-thumb.js
 * ----------------------------------------------------------------------------
 * Demo-video reel thumbnails were cropping the full image because the card is
 * 168x280 (not 9:16) and the image is drawn at 120% overscan with a drifting
 * animation. Even a perfect 9:16 image loses ~20%.
 *
 * FIX (in public/tmc-reels.js):
 *   1) make the card a true 9:16 (168 x 299)
 *   2) remove the 120% overscan + drift so the image sits at 100% -> with a 9:16
 *      image in a 9:16 card, object-fit:cover shows the FULL image, no crop/bars.
 *
 * WEBSITE updates on git push. The APP bundles this file, so for the app it also
 * needs: npx cap sync android + rebuild + a fresh AAB.
 *
 * SAFE: byte-preserving (latin1 + ASCII), idempotent, each anchor must match once.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const PUB = path.join('public', 'tmc-reels.js');
const ROOT = 'tmc-reels.js';

const E1_FROM = 'width:168px;height:280px;';
const E1_TO   = 'width:168px;height:299px;';
const E2_FROM = '.tmc-r-thumb img,.tmc-r-thumb .tmc-r-bg{position:absolute;inset:-10%;width:120%;height:120%;object-fit:cover;animation:tmcBgDrift 14s ease-in-out infinite alternate;will-change:transform}';
const E2_TO   = '.tmc-r-thumb img,.tmc-r-thumb .tmc-r-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}';

function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function count(s, sub) { return s.split(sub).length - 1; }

function patch(file, isRoot) {
  if (!fs.existsSync(file)) return isRoot ? { status: 'skip (no root copy)' } : { status: 'ABORT - not found' };
  const orig = fs.readFileSync(file, 'latin1');
  if (orig.indexOf(E1_TO) !== -1 && orig.indexOf(E2_TO) !== -1) return { status: 'already applied (skip)' };
  const c1 = count(orig, E1_FROM), c2 = count(orig, E2_FROM);
  if (c1 !== 1) return { status: 'ABORT - card-size anchor matched ' + c1 };
  if (c2 !== 1) return { status: 'ABORT - image-style anchor matched ' + c2 };
  let updated = orig.split(E1_FROM).join(E1_TO).split(E2_FROM).join(E2_TO);
  if (updated.indexOf(E1_TO) === -1 || updated.indexOf(E2_TO) === -1) return { status: 'ABORT - post-edit check failed' };
  const b = file + '.bak-' + stamp();
  fs.copyFileSync(file, b);
  fs.writeFileSync(file, Buffer.from(updated, 'latin1'));
  return { status: 'reels thumbnails now show full image', backup: path.basename(b) };
}

console.log('claude-patch-19-reels-full-thumb.js');
console.log('-----------------------------------');
const r = patch(PUB, false);
console.log(PUB + ': ' + r.status + (r.backup ? '  (backup: ' + r.backup + ')' : ''));
if (r.status.indexOf('ABORT') === 0) process.exit(1);
if (r.status.indexOf('reels thumbnails') === 0 && fs.existsSync(ROOT)) {
  const rb = ROOT + '.bak-' + stamp(); fs.copyFileSync(ROOT, rb); fs.copyFileSync(PUB, ROOT);
  console.log(ROOT + ': mirrored from public  (backup: ' + path.basename(rb) + ')');
}
console.log('-----------------------------------');
console.log('Deploy: git add -A && commit && push (fixes WEBSITE). For the APP: npx cap sync android + rebuild + fresh AAB.');
process.exit(0);
