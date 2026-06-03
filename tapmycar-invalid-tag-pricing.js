/* ============================================================================
 * TapMyCar  Small UX fix  Invalid Tag button -> pricing.html
 * ----------------------------------------------------------------------------
 * Run: node tapmycar-invalid-tag-pricing.js
 *
 * On the Invalid Tag screen (when someone scans an unregistered tag), the
 * "Visit tapmycar.io" button currently points to the homepage. For users who
 * land here after testing the system, the right destination is the pricing
 * page so they can actually get their own sticker. Also relabels the button
 * "Get your sticker" for clearer intent.
 *
 * Tag Disabled state (different scenario) is left unchanged.
 *
 * SAFE TO RE-RUN: skipped if file already has the new URL.
 * ==========================================================================*/

'use strict';
const fs = require('fs');

const PATH = 'public/contact.html';
const OLD = '<div style="font-size:14px;color:rgba(255,255,255,.75);max-width:280px;line-height:1.6">This tag is not registered in the TapMyCar system.</div>\n    <a href="https://tapmycar.io" style="background:#fff;color:#DC2626;font-size:14px;font-weight:700;padding:14px 32px;border-radius:13px;text-decoration:none;margin-top:8px">Visit tapmycar.io</a>';
const NEW = '<div style="font-size:14px;color:rgba(255,255,255,.75);max-width:280px;line-height:1.6">This tag is not registered in the TapMyCar system.</div>\n    <a href="https://tapmycar.io/pricing.html" style="background:#fff;color:#DC2626;font-size:14px;font-weight:700;padding:14px 32px;border-radius:13px;text-decoration:none;margin-top:8px">Get your sticker</a>';

const raw = fs.readFileSync(PATH, 'utf8');
if (raw.indexOf('href="https://tapmycar.io/pricing.html"') !== -1 &&
    raw.indexOf('Get your sticker') !== -1) {
  console.log(PATH + ': already patched, skipping.');
  process.exit(0);
}
const wasCRLF = raw.indexOf('\r\n') !== -1;
let text = raw.replace(/\r\n/g, '\n');
const count = text.split(OLD).length - 1;
if (count !== 1) {
  console.error('ERROR: expected exactly 1 match, found ' + count);
  process.exit(1);
}
text = text.replace(OLD, NEW);
if (wasCRLF) text = text.replace(/\n/g, '\r\n');
fs.writeFileSync(PATH, text, 'utf8');
console.log(PATH + ': patched OK');
console.log('\nNEXT STEPS:');
console.log('  git add -A');
console.log('  git commit -m "Invalid Tag: point button to pricing.html"');
console.log('  git push');
