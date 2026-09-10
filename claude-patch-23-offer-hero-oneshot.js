#!/usr/bin/env node
// ============================================================================
// claude-patch-23-offer-hero-oneshot.js
// ----------------------------------------------------------------------------
// ONE file that does everything: removes any old (v1/v2) launch-offer markup,
// then installs the v3 offer as a dark card INSIDE the hero (above the
// "Privacy + Safety" pill) on landing.html, and on pricing.html adds the card
// at top of body + crossed-price lines above each plan price.
//
// DISPLAY ONLY — Stripe checkout amounts unchanged ($9.99 / $24.99).
// Safe: latin1 byte-preserving, backups, idempotent (re-run = no dup).
// ============================================================================

'use strict';
const fs = require('fs');
const path = require('path');

const V3TAG = 'TMC_OFFER_V3';  // v3 marker (distinct so we can detect v3 specifically)

const STYLE =
'<style>/* TMC_LAUNCH_OFFER ' + V3TAG + ' */\n' +
'@keyframes tmcOfferPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}\n' +
'@keyframes tmcFlameWiggle{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(6deg)}}\n' +
'@keyframes tmcCardGlow{0%,100%{box-shadow:0 8px 22px rgba(0,0,0,.28)}50%{box-shadow:0 8px 34px rgba(0,0,0,.45)}}\n' +
'@keyframes tmcShine{0%{left:-60%}100%{left:130%}}\n' +
'@keyframes tmcOfferBadgePulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}\n' +
'.tmc-offer-card{position:relative;overflow:hidden;display:block;max-width:520px;width:100%;background:#111;color:#fff;border-radius:16px;padding:14px 18px;margin:0 auto 22px;border:2px solid #FFD84D;animation:tmcCardGlow 2.4s ease-in-out infinite;text-align:center;box-sizing:border-box}\n' +
'.tmc-offer-card::after{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(115deg,transparent,rgba(255,255,255,.18),transparent);transform:skewX(-18deg);animation:tmcShine 3.2s ease-in-out infinite;pointer-events:none}\n' +
'.tmc-offer-top{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;position:relative;z-index:1}\n' +
'.tmc-offer-pill{display:inline-flex;align-items:center;gap:6px;background:#FF6B00;color:#fff;font-size:11px;font-weight:900;letter-spacing:1px;padding:4px 11px;border-radius:30px;text-transform:uppercase;animation:tmcOfferPulse 1.3s ease-in-out infinite}\n' +
'.tmc-offer-flame{display:inline-block;animation:tmcFlameWiggle .6s ease-in-out infinite}\n' +
'.tmc-offer-headline{font-size:18px;font-weight:900;letter-spacing:-.2px;color:#FFD84D}\n' +
'.tmc-offer-sub{font-size:13px;font-weight:600;margin-top:6px;color:rgba(255,255,255,.9);position:relative;z-index:1}\n' +
'.tmc-offer-sub b{color:#fff;font-weight:900;background:#FF6B00;padding:1px 7px;border-radius:6px}\n' +
'@media(max-width:520px){.tmc-offer-headline{font-size:16px}}\n' +
'.tmc-was{color:#9CA3AF;text-decoration:line-through;font-weight:600;font-size:.62em;margin-right:7px}\n' +
'.tmc-offer-badge{display:inline-block;background:#DC2626;color:#fff;font-size:10px;font-weight:800;padding:3px 9px;border-radius:20px;margin-left:8px;vertical-align:middle;animation:tmcOfferBadgePulse 1.5s ease-in-out infinite;letter-spacing:.3px;white-space:nowrap}\n' +
'.tmc-offer-line{font-size:13px;margin-bottom:3px;line-height:1.2}\n' +
'</style>';

const CARD =
'<div class="tmc-offer-card"><div class="tmc-offer-top">' +
'<span class="tmc-offer-pill"><span class="tmc-offer-flame">&#128293;</span> Limited Time</span>' +
'<span class="tmc-offer-headline">Launch Offer is LIVE &mdash; up to 37% OFF!</span>' +
'</div><div class="tmc-offer-sub">Get your tag now &middot; Standard <b>$9.99</b> &middot; Premium <b>$24.99</b> &middot; before it ends!</div></div>';

const STD_LINE  = '<div class="tmc-offer-line"><span class="tmc-was">$15.99</span><span class="tmc-offer-badge">LAUNCH OFFER &middot; SAVE $6</span></div>';
const PREM_LINE = '<div class="tmc-offer-line"><span class="tmc-was">$39.99</span><span class="tmc-offer-badge">LAUNCH OFFER &middot; SAVE $15</span></div>';
const HERO_BADGE = '<div class="hero-badge"><div class="hero-badge-dot"></div>';

// --- removal regexes for ANY prior offer markup ---
const RE_STYLE   = /<style>\/\* TMC_LAUNCH_OFFER[\s\S]*?<\/style>\s*/g;
const RE_BANNER  = /<div class="tmc-offer-banner">[\s\S]*?<\/div>\s*<\/div>\s*/g;
const RE_BANNER2 = /<div class="tmc-offer-banner">[\s\S]*?<\/div>\s*/g;
const RE_CARD    = /<div class="tmc-offer-card">[\s\S]*?<\/div>\s*<\/div>\s*/g;
const RE_LINE    = /<div class="tmc-offer-line">[\s\S]*?<\/div>\s*/g;

function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function countStr(s, sub) { return s.split(sub).length - 1; }

function stripOld(text) {
  text = text.replace(RE_BANNER, '');
  text = text.replace(RE_BANNER2, '');
  text = text.replace(RE_CARD, '');
  text = text.replace(RE_LINE, '');
  text = text.replace(RE_STYLE, '');
  return text;
}

function processLanding() {
  const pub = path.join('public', 'landing.html');
  if (!fs.existsSync(pub)) return console.log('  ' + pub + ': not found (skip)');
  const orig = fs.readFileSync(pub, 'latin1');

  // strip any prior offer, then verify it's clean
  let text = stripOld(orig);
  if (text.indexOf('TMC_LAUNCH_OFFER') !== -1 || text.indexOf('tmc-offer-') !== -1) {
    return console.log('  ' + pub + ': ABORT - leftover offer markup after strip; tell me and I will target it.');
  }
  // now install v3
  if (!/<\/head>/i.test(text)) return console.log('  ' + pub + ': no </head>; skip');
  if (countStr(text, HERO_BADGE) !== 1) return console.log('  ' + pub + ': hero-badge anchor matched ' + countStr(text, HERO_BADGE) + '; skip');
  if (countStr(text, '<div class="pricing-price">$9.99 <span>+ $9.99/yr</span></div>') !== 1) return console.log('  ' + pub + ': $9.99 price anchor not unique; skip');
  if (countStr(text, '<div class="pricing-price">$24.99 <span>+ $19.99/yr</span></div>') !== 1) return console.log('  ' + pub + ': $24.99 price anchor not unique; skip');

  text = text.replace(/<\/head>/i, STYLE + '\n</head>');
  text = text.replace(HERO_BADGE, CARD + '\n  ' + HERO_BADGE);
  text = text.replace('<div class="pricing-price">$9.99 <span>+ $9.99/yr</span></div>', STD_LINE + '\n    <div class="pricing-price">$9.99 <span>+ $9.99/yr</span></div>');
  text = text.replace('<div class="pricing-price">$24.99 <span>+ $19.99/yr</span></div>', PREM_LINE + '\n    <div class="pricing-price">$24.99 <span>+ $19.99/yr</span></div>');

  write(pub, 'landing.html', orig, text);
}

function processPricing() {
  const pub = path.join('public', 'pricing.html');
  if (!fs.existsSync(pub)) return console.log('  ' + pub + ': not found (skip)');
  const orig = fs.readFileSync(pub, 'latin1');
  let text = stripOld(orig);
  if (text.indexOf('TMC_LAUNCH_OFFER') !== -1 || text.indexOf('tmc-offer-') !== -1) {
    return console.log('  ' + pub + ': ABORT - leftover offer markup after strip.');
  }
  if (!/<\/head>/i.test(text)) return console.log('  ' + pub + ': no </head>; skip');
  const bodyRe = /<body[^>]*>/i;
  if (!bodyRe.test(text)) return console.log('  ' + pub + ': no <body>; skip');
  if (countStr(text, '<div id="std-price"') !== 1) return console.log('  ' + pub + ': std-price anchor not unique; skip');
  if (countStr(text, '<div id="prem-price"') !== 1) return console.log('  ' + pub + ': prem-price anchor not unique; skip');

  text = text.replace(/<\/head>/i, STYLE + '\n</head>');
  text = text.replace(bodyRe, function (m) { return m + '\n' + CARD; });
  text = text.replace('<div id="std-price"', STD_LINE + '\n      <div id="std-price"');
  text = text.replace('<div id="prem-price"', PREM_LINE + '\n      <div id="prem-price"');

  write(pub, 'pricing.html', orig, text);
}

function write(pub, rel, orig, text) {
  if (text === orig) return console.log('  ' + pub + ': no change');
  const b = pub + '.bak-' + stamp();
  fs.copyFileSync(pub, b);
  fs.writeFileSync(pub, Buffer.from(text, 'latin1'));
  let extra = '';
  if (fs.existsSync(rel)) { const rb = rel + '.bak-' + stamp(); fs.copyFileSync(rel, rb); fs.copyFileSync(pub, rel); extra = ' -> mirrored to root'; }
  console.log('  ' + pub + ': offer set to v3 (hero card).' + extra + '  (backup: ' + path.basename(b) + ')');
}

console.log('claude-patch-23-offer-hero-oneshot.js');
console.log('-------------------------------------');
processLanding();
processPricing();
console.log('-------------------------------------');
console.log('Done. git add/commit/push -> Vercel redeploys. Checkout amounts unchanged.');
process.exit(0);
