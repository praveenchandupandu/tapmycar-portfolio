#!/usr/bin/env node
/* ============================================================================
 * claude-patch-22-launch-offer.js   (v2 — big highlighted banner)
 * ----------------------------------------------------------------------------
 * Adds an animated "Launch Offer" to landing.html + pricing.html:
 *   - a BIG highlighted banner: pulsing "LIMITED TIME" pill (wiggling flame),
 *     shimmer + glow, headline "Launch Offer is LIVE — up to 37% OFF!" and a
 *     subline with the prices.
 *   - crossed-out "regular" price (Standard $15.99, Premium $39.99) shown on its
 *     own line ABOVE the real price ($9.99 / $24.99), with a pulsing SAVE badge.
 *
 * DISPLAY ONLY — Stripe checkout amounts are NOT changed (still $9.99 / $24.99).
 * On BOTH pages the crossed price is a SEPARATE element, so it never touches the
 * pricing.html coupon/referral JS.
 *
 * SCOPE: public/landing.html + public/pricing.html (mirrored to root if present).
 * Static -> git push. Does NOT touch the app bundle or checkout.
 *
 * SAFE: byte-preserving (latin1 + ASCII inserts; emoji via HTML entity),
 * idempotent, each anchor must match exactly once or that FILE is skipped with a
 * clear message. Per-file backups.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const MARKER = 'TMC_LAUNCH_OFFER';

const STYLE =
'<style>/* ' + MARKER + ' */\n' +
'@keyframes tmcOfferShimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}\n' +
'@keyframes tmcOfferPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}\n' +
'@keyframes tmcPricePop{0%{transform:scale(.7);opacity:0}60%{transform:scale(1.14)}100%{transform:scale(1);opacity:1}}\n' +
'@keyframes tmcBannerGlow{0%,100%{box-shadow:0 3px 16px rgba(255,107,0,.45)}50%{box-shadow:0 3px 30px rgba(255,107,0,.85)}}\n' +
'@keyframes tmcFlameWiggle{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(6deg)}}\n' +
'.tmc-offer-banner{position:relative;overflow:hidden;background:linear-gradient(90deg,#E85D00,#FF6B00,#FFB067,#FF6B00,#E85D00);background-size:250% 100%;animation:tmcOfferShimmer 4s linear infinite, tmcBannerGlow 2.2s ease-in-out infinite;color:#fff;text-align:center;padding:16px 14px 18px;border-bottom:3px solid #C24E00}\n' +
'.tmc-offer-top{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap}\n' +
'.tmc-offer-pill{display:inline-flex;align-items:center;gap:6px;background:#111;color:#FFD84D;font-size:12px;font-weight:900;letter-spacing:1px;padding:5px 12px;border-radius:30px;text-transform:uppercase;animation:tmcOfferPulse 1.3s ease-in-out infinite;box-shadow:0 2px 8px rgba(0,0,0,.35)}\n' +
'.tmc-offer-flame{display:inline-block;animation:tmcFlameWiggle .6s ease-in-out infinite}\n' +
'.tmc-offer-headline{font-size:22px;font-weight:900;letter-spacing:-.3px;line-height:1.1;text-shadow:0 2px 6px rgba(0,0,0,.25)}\n' +
'.tmc-offer-sub{font-size:13.5px;font-weight:600;margin-top:6px;opacity:.97}\n' +
'.tmc-offer-sub b{font-weight:900;background:rgba(255,255,255,.22);padding:1px 7px;border-radius:6px}\n' +
'@media(max-width:520px){.tmc-offer-headline{font-size:18px}}\n' +
'.tmc-was{color:#9CA3AF;text-decoration:line-through;font-weight:600;font-size:.62em;margin-right:7px}\n' +
'.tmc-offer-badge{display:inline-block;background:#DC2626;color:#fff;font-size:10px;font-weight:800;padding:3px 9px;border-radius:20px;margin-left:8px;vertical-align:middle;animation:tmcOfferPulse 1.5s ease-in-out infinite;letter-spacing:.3px;white-space:nowrap}\n' +
'.tmc-offer-line{font-size:13px;margin-bottom:3px;line-height:1.2}\n' +
'</style>';

const BANNER =
'<div class="tmc-offer-banner">' +
'<div class="tmc-offer-top">' +
'<span class="tmc-offer-pill"><span class="tmc-offer-flame">&#128293;</span> Limited Time</span>' +
'<span class="tmc-offer-headline">Launch Offer is LIVE &mdash; up to 37% OFF!</span>' +
'</div>' +
'<div class="tmc-offer-sub">Get your privacy tag now &middot; Standard <b>$9.99</b> &middot; Premium <b>$24.99</b> &middot; before it ends!</div>' +
'</div>';

const STD_LINE = '<div class="tmc-offer-line"><span class="tmc-was">$15.99</span><span class="tmc-offer-badge">LAUNCH OFFER &middot; SAVE $6</span></div>';
const PREM_LINE = '<div class="tmc-offer-line"><span class="tmc-was">$39.99</span><span class="tmc-offer-badge">LAUNCH OFFER &middot; SAVE $15</span></div>';

const PLANS = {
  'landing.html': [
    { re: /<\/head>/i, replace: STYLE + '\n</head>' },
    { body: true },
    // landing prices are static; insert the offer line just before each pricing-price div
    { find: '<div class="pricing-price">$9.99 <span>+ $9.99/yr</span></div>',
      replace: STD_LINE + '\n    <div class="pricing-price">$9.99 <span>+ $9.99/yr</span></div>' },
    { find: '<div class="pricing-price">$24.99 <span>+ $19.99/yr</span></div>',
      replace: PREM_LINE + '\n    <div class="pricing-price">$24.99 <span>+ $19.99/yr</span></div>' }
  ],
  'pricing.html': [
    { re: /<\/head>/i, replace: STYLE + '\n</head>' },
    { body: true },
    { find: '<div id="std-price"',  replace: STD_LINE + '\n      <div id="std-price"' },
    { find: '<div id="prem-price"', replace: PREM_LINE + '\n      <div id="prem-price"' }
  ]
};

function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function countStr(s, sub) { return s.split(sub).length - 1; }

function processFile(rel, edits) {
  const pub = path.join('public', rel);
  if (!fs.existsSync(pub)) return console.log('  ' + pub + ': not found (skip)');
  let text = fs.readFileSync(pub, 'latin1');
  if (text.indexOf(MARKER) !== -1) return console.log('  ' + pub + ': already has launch offer (skip)');

  const bodyRe = /<body[^>]*>/i;
  for (const e of edits) {
    if (e.body) { if (!bodyRe.test(text)) return console.log('  ' + pub + ': <body> not found; skipped, no change'); continue; }
    if (e.re) { const n = (text.match(new RegExp(e.re, 'g')) || []).length; if (n !== 1) return console.log('  ' + pub + ': </head> matched ' + n + '; skipped, no change'); continue; }
    const n = countStr(text, e.find);
    if (n !== 1) return console.log('  ' + pub + ': anchor "' + e.find.slice(0, 42) + '..." matched ' + n + '; skipped, no change');
  }

  for (const e of edits) {
    if (e.body) { text = text.replace(bodyRe, function (m) { return m + '\n' + BANNER; }); continue; }
    if (e.re) { text = text.replace(e.re, e.replace); continue; }
    text = text.replace(e.find, e.replace);
  }
  if (text.indexOf(MARKER) === -1) return console.log('  ' + pub + ': post-edit marker missing; skipped');

  const b = pub + '.bak-' + stamp();
  fs.copyFileSync(pub, b);
  fs.writeFileSync(pub, Buffer.from(text, 'latin1'));
  let extra = '';
  if (fs.existsSync(rel)) { const rb = rel + '.bak-' + stamp(); fs.copyFileSync(rel, rb); fs.copyFileSync(pub, rel); extra = ' -> mirrored to root'; }
  console.log('  ' + pub + ': launch offer added.' + extra + '  (backup: ' + path.basename(b) + ')');
}

console.log('claude-patch-22-launch-offer.js (v2)');
console.log('------------------------------------');
processFile('landing.html', PLANS['landing.html']);
processFile('pricing.html', PLANS['pricing.html']);
console.log('------------------------------------');
console.log('Done. git add/commit/push -> Vercel redeploys. Checkout amounts unchanged.');
process.exit(0);
