#!/usr/bin/env node
// ============================================================================
// claude-patch-22b-reset-offer.js
// ----------------------------------------------------------------------------
// Removes the previous (v1/v2) launch-offer markup from landing.html + pricing.html
// so the v3 offer patch can apply cleanly. Strips:
//   - the injected style block tagged TMC_LAUNCH_OFFER
//   - the top-of-page banner div (tmc-offer-banner)
//   - the crossed-price offer lines (tmc-offer-line)
// Leaves everything else untouched. Run this, THEN run claude-patch-22 (v3).
//
// SAFE: byte-preserving (latin1), backups, idempotent. Static only.
// ============================================================================

'use strict';
const fs = require('fs');
const path = require('path');

const MARKER = 'TMC_LAUNCH_OFFER';

const RE_STYLE  = /<style>\/\* TMC_LAUNCH_OFFER \*\/[\s\S]*?<\/style>\s*/;
const RE_BANNER = /<div class="tmc-offer-banner">[\s\S]*?<\/div>\s*<\/div>\s*/;
const RE_BANNER2= /<div class="tmc-offer-banner">[\s\S]*?<\/div>\s*/;
const RE_LINE   = /<div class="tmc-offer-line">[\s\S]*?<\/div>\s*/g;

function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function clean(rel) {
  const pub = path.join('public', rel);
  if (!fs.existsSync(pub)) return console.log('  ' + pub + ': not found (skip)');
  let text = fs.readFileSync(pub, 'latin1');
  if (text.indexOf(MARKER) === -1) return console.log('  ' + pub + ': no offer markup present (already clean)');

  const before = text;
  if (RE_BANNER.test(text)) text = text.replace(RE_BANNER, '');
  else if (RE_BANNER2.test(text)) text = text.replace(RE_BANNER2, '');
  text = text.replace(RE_LINE, '');
  text = text.replace(RE_STYLE, '');

  if (text.indexOf(MARKER) !== -1) {
    return console.log('  ' + pub + ': ABORT - could not fully remove old offer (marker remains). No change; tell me and I will target it exactly.');
  }
  if (text === before) return console.log('  ' + pub + ': nothing matched to remove (skip)');

  const b = pub + '.bak-' + stamp();
  fs.copyFileSync(pub, b);
  fs.writeFileSync(pub, Buffer.from(text, 'latin1'));
  let extra = '';
  if (fs.existsSync(rel)) { const rb = rel + '.bak-' + stamp(); fs.copyFileSync(rel, rb); fs.copyFileSync(pub, rel); extra = ' -> mirrored to root'; }
  console.log('  ' + pub + ': old offer removed.' + extra + '  (backup: ' + path.basename(b) + ')');
}

console.log('claude-patch-22b-reset-offer.js');
console.log('-------------------------------');
clean('landing.html');
clean('pricing.html');
console.log('-------------------------------');
console.log('Old offer stripped. NEXT: run claude-patch-22-launch-offer.js (v3), then commit + push.');
process.exit(0);
