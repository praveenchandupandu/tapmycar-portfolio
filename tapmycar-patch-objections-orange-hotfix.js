/* ============================================================================
 * TapMyCar  Patch  Landing objection sections HOTFIX
 *
 * Fixes two bugs from the previous v2 patch:
 *   1) Duplicate sections: the old v1 sections were never removed because the
 *      removal regex required the chev BEFORE the comment marker, but v1 had
 *      the comment BEFORE the chev. So both v1 and v2 ended up on the page.
 *   2) Color mismatch: v2 used cyan/blue accents in the harassment section,
 *      which didn't match the TapMyCar brand. This patch rethemes that
 *      section with orange accents (matching the existing App banner).
 *
 * What it does:
 *   - Removes ALL prior versions of these sections (v1 OR v2-cyan) safely
 *   - Inserts new V2_ORANGE sections (HTML + CSS)
 *   - Cleans up any stray escaped apostrophes
 *
 * Idempotent: skips if TMC_LAND_OBJECTIONS_V2_ORANGE is already present.
 *
 * Run from project root:  node tapmycar-patch-objections-orange-hotfix.js
 * Safe to re-run.
 * ==========================================================================*/
'use strict';
const fs   = require('fs');
const path = require('path');

const STAMP      = new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
const BACKUP_DIR = 'backup-objections-orange-' + STAMP;
const TARGET     = path.join('public', 'landing.html');

if (!fs.existsSync(TARGET)) { console.error(TARGET + ' not found.'); process.exit(1); }
let text = fs.readFileSync(TARGET, 'utf8');

if (text.indexOf('TMC_LAND_OBJECTIONS_V2_ORANGE') !== -1) {
  console.log(TARGET + ': skip (already at orange v2)');
  process.exit(0);
}

const V2_HTML = "<!-- TMC_LAND_OBJECTIONS_V2_ORANGE: premium 3D sections, brand-matched palette -->\n<section class=\"lo-harass\">\n  <div class=\"lo-harass-orb a\"></div>\n  <div class=\"lo-harass-orb b\"></div>\n  <div class=\"lo-eyebrow lo-eyebrow-dark\"><span class=\"lo-pulse\"></span>Common questions</div>\n  <h2 class=\"lo-h2 lo-h2-dark\">What if someone <span class=\"lo-grad-warm\">abuses</span> the system?</h2>\n  <p class=\"lo-lede lo-lede-dark\">Your real number stays hidden no matter what. A stranger calling repeatedly never has a way to follow you outside TapMyCar.</p>\n  <div class=\"lo-shield-wrap\">\n    <div class=\"lo-shield-glow\"></div>\n    <div class=\"lo-shield-ring\"></div>\n    <div class=\"lo-shield-ring2\"></div>\n    <div class=\"lo-shield\">\n      <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z\"/><polyline points=\"9 12 11 14 15 10\"/></svg>\n    </div>\n  </div>\n  <div class=\"lo-pillars\">\n    <div class=\"lo-pillar lo-pillar-dark\"><div class=\"lo-pillar-num lo-pillar-num-light\">1</div><div><h3>One tap blocks any number</h3><p>Block instantly. They can’t reach you again.</p></div></div>\n    <div class=\"lo-pillar lo-pillar-dark\"><div class=\"lo-pillar-num lo-pillar-num-light\">2</div><div><h3>Every call logged with timestamp</h3><p>Full audit trail. Report abuse with one tap.</p></div></div>\n    <div class=\"lo-pillar lo-pillar-dark\"><div class=\"lo-pillar-num lo-pillar-num-light\">3</div><div><h3>Your number was never shared</h3><p>They never had it, so they can’t find you outside TapMyCar.</p></div></div>\n  </div>\n</section>\n\n<section class=\"lo-tow\">\n  <div class=\"lo-eyebrow lo-eyebrow-orange\"><span class=\"lo-pulse\"></span>Built with towing companies in mind</div>\n  <h2 class=\"lo-h2\">When your car is towed, <span class=\"lo-grad-orange\">you’re the first to know.</span></h2>\n  <p class=\"lo-lede lo-lede-orange\">Towing companies care about getting drivers reunited with their cars. With TapMyCar, that becomes effortless.</p>\n  <div class=\"lo-flow\">\n    <div class=\"lo-step\"><div class=\"lo-step-ic-wrap\"><div class=\"lo-step-ic-glow\"></div><div class=\"lo-step-ic\"><span class=\"lo-step-num\">1</span><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 8a4 4 0 0 1 0 8\"/><path d=\"M12 4a8 8 0 0 1 0 16\"/><circle cx=\"12\" cy=\"12\" r=\"1.5\" fill=\"#fff\"/></svg></div></div><div class=\"lo-step-label\">Towing co. taps</div><div class=\"lo-step-sub\">your sticker</div></div>\n    <div class=\"lo-step\"><div class=\"lo-step-ic-wrap\"><div class=\"lo-step-ic-glow\"></div><div class=\"lo-step-ic\"><span class=\"lo-step-num\">2</span><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"22\" y1=\"2\" x2=\"11\" y2=\"13\"/><polygon points=\"22 2 15 22 11 13 2 9 22 2\" fill=\"rgba(255,255,255,.18)\"/></svg></div></div><div class=\"lo-step-label\">Alert sent</div><div class=\"lo-step-sub\">company · phone · lot</div></div>\n    <div class=\"lo-step\"><div class=\"lo-step-ic-wrap\"><div class=\"lo-step-ic-glow\"></div><div class=\"lo-step-ic\"><span class=\"lo-step-num\">3</span><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9\"/><path d=\"M13.73 21a2 2 0 0 1-3.46 0\"/></svg></div></div><div class=\"lo-step-label\">You receive</div><div class=\"lo-step-sub\">in seconds</div></div>\n  </div>\n  <div class=\"lo-pillars\">\n    <div class=\"lo-pillar lo-pillar-cream\"><div class=\"lo-pillar-num lo-pillar-num-orange\">1</div><div><h3>Towing company taps your sticker</h3><p>Pre-filled message in 5 seconds.</p></div></div>\n    <div class=\"lo-pillar lo-pillar-cream\"><div class=\"lo-pillar-num lo-pillar-num-orange\">2</div><div><h3>You’re notified in seconds</h3><p>Email + push: lot address, company, who to call.</p></div></div>\n    <div class=\"lo-pillar lo-pillar-cream\"><div class=\"lo-pillar-num lo-pillar-num-orange\">3</div><div><h3>Recovery in minutes, not hours</h3><p>We partner with towing companies. Less stress for everyone.</p></div></div>\n  </div>\n</section>\n";
const V2_CSS  = "/* TMC_LAND_OBJECTIONS_V2_ORANGE  premium 3D sections, brand-matched orange palette */\n.lo-harass, .lo-tow { position: relative; overflow: hidden; padding: 44px 22px 40px; }\n.lo-harass { background: linear-gradient(180deg, #0C1B33 0%, #0A1428 60%, #050E1F 100%); color: #fff; }\n.lo-harass::before { content: ''; position: absolute; inset: 0; background-image: linear-gradient(rgba(255,107,0,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,107,0,.04) 1px, transparent 1px); background-size: 28px 28px; mask-image: radial-gradient(ellipse at 50% 40%, #000 0%, transparent 75%); -webkit-mask-image: radial-gradient(ellipse at 50% 40%, #000 0%, transparent 75%); animation: loGridDrift 22s linear infinite; pointer-events: none; }\n@keyframes loGridDrift { to { background-position: 28px 28px; } }\n.lo-harass-orb { position: absolute; width: 240px; height: 240px; border-radius: 50%; filter: blur(60px); pointer-events: none; }\n.lo-harass-orb.a { background: rgba(255,107,0,.35); top: -80px; right: -80px; animation: loOrb 9s ease-in-out infinite alternate; }\n.lo-harass-orb.b { background: rgba(255,138,76,.22); bottom: -100px; left: -60px; animation: loOrb 11s ease-in-out infinite alternate-reverse; }\n.lo-tow { background: linear-gradient(180deg, #FFF7ED 0%, #FFEEDC 100%); color: #111; }\n.lo-tow::before { content: ''; position: absolute; width: 280px; height: 280px; border-radius: 50%; background: radial-gradient(circle, rgba(255,107,0,.22) 0%, transparent 65%); top: -90px; right: -90px; filter: blur(20px); animation: loOrb 10s ease-in-out infinite alternate; pointer-events: none; }\n.lo-tow::after { content: ''; position: absolute; width: 220px; height: 220px; border-radius: 50%; background: radial-gradient(circle, rgba(251,191,36,.25) 0%, transparent 65%); bottom: -70px; left: -70px; filter: blur(20px); animation: loOrb 8s ease-in-out infinite alternate-reverse; pointer-events: none; }\n@keyframes loOrb { from { transform: translate(0,0) scale(1); } to { transform: translate(15px, 20px) scale(1.15); } }\n.lo-eyebrow { position: relative; z-index: 2; display: inline-flex; align-items: center; gap: 8px; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-radius: 99px; padding: 6px 12px; font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 14px; border: 1px solid; }\n.lo-eyebrow-dark { background: rgba(255,107,0,.14); border-color: rgba(255,107,0,.4); color: #FFAB7A; }\n.lo-eyebrow-orange { background: rgba(255,107,0,.12); border-color: rgba(255,107,0,.35); color: #9A3412; }\n.lo-pulse { width: 7px; height: 7px; border-radius: 50%; animation: loPulse 1.6s ease-in-out infinite; }\n.lo-eyebrow-dark .lo-pulse { background: #FF6B00; box-shadow: 0 0 10px #FF6B00; }\n.lo-eyebrow-orange .lo-pulse { background: #FF6B00; box-shadow: 0 0 10px #FF6B00; }\n@keyframes loPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.7); } }\n.lo-h2 { position: relative; z-index: 2; font-size: 28px; font-weight: 800; line-height: 1.1; letter-spacing: -.6px; margin: 0 0 12px; }\n.lo-h2-dark { color: #fff; }\n.lo-grad-warm { background: linear-gradient(135deg, #fff 0%, #FFD9B8 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }\n.lo-grad-orange { background: linear-gradient(135deg, #7C2D12 0%, #FF6B00 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }\n.lo-lede { position: relative; z-index: 2; font-size: 14px; line-height: 1.6; margin: 0 0 22px; }\n.lo-lede-dark { color: rgba(255,255,255,.7); }\n.lo-lede-orange { color: #9A3412; }\n.lo-shield-wrap { position: relative; z-index: 2; width: 110px; height: 110px; margin: 0 auto 22px; perspective: 800px; }\n.lo-shield-glow { position: absolute; inset: -20px; border-radius: 50%; background: radial-gradient(circle, rgba(255,107,0,.55) 0%, transparent 65%); filter: blur(20px); animation: loIcGlow 3s ease-in-out infinite alternate; }\n.lo-shield-ring { position: absolute; inset: -8px; border-radius: 50%; border: 1.5px solid rgba(255,107,0,.4); animation: loSpin 14s linear infinite; }\n.lo-shield-ring::before { content: ''; position: absolute; width: 10px; height: 10px; border-radius: 50%; background: #FF6B00; top: -5px; left: 50%; margin-left: -5px; box-shadow: 0 0 14px #FF6B00; }\n.lo-shield-ring2 { position: absolute; inset: 4px; border-radius: 50%; border: 1px dashed rgba(255,171,122,.4); animation: loSpin 22s linear infinite reverse; }\n.lo-shield { position: absolute; inset: 16px; border-radius: 24px; background: linear-gradient(135deg, #FF6B00 0%, #C2410C 100%); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 2px rgba(255,138,76,.5), 0 20px 40px rgba(124,45,18,.6), inset 0 2px 0 rgba(255,255,255,.3); animation: loFloat 6s ease-in-out infinite; transform-style: preserve-3d; }\n.lo-shield svg { width: 36px; height: 36px; }\n@keyframes loFloat { 0%,100% { transform: rotateY(-20deg) rotateX(8deg); } 50% { transform: rotateY(20deg) rotateX(-6deg) translateY(-4px); } }\n@keyframes loSpin { to { transform: rotate(360deg); } }\n@keyframes loIcGlow { from { opacity: .5; transform: scale(.92); } to { opacity: 1; transform: scale(1.1); } }\n.lo-pillars { position: relative; z-index: 2; display: flex; flex-direction: column; gap: 10px; }\n.lo-pillar { padding: 14px; border-radius: 14px; display: flex; gap: 12px; align-items: flex-start; border: 1px solid; backdrop-filter: blur(16px) saturate(160%); -webkit-backdrop-filter: blur(16px) saturate(160%); will-change: transform, box-shadow; }\n.lo-pillar > div:last-child { flex: 1; min-width: 0; }\n.lo-pillar h3 { margin: 0 0 3px; font-size: 13px; font-weight: 800; }\n.lo-pillar p { margin: 0; font-size: 11.5px; line-height: 1.55; }\n.lo-pillar-dark { background: rgba(255,255,255,.04); border-color: rgba(255,107,0,.18); animation: loBreathDark 8s ease-in-out infinite; }\n.lo-pillar-dark h3 { color: #fff; }\n.lo-pillar-dark p { color: rgba(255,255,255,.62); }\n.lo-pillar-cream { background: rgba(255,255,255,.6); border-color: rgba(255,107,0,.25); animation: loBreathOrange 8s ease-in-out infinite; }\n.lo-pillar-cream h3 { color: #111; }\n.lo-pillar-cream p { color: #6B7280; }\n.lo-pillars .lo-pillar:nth-child(2) { animation-delay: -2.7s; }\n.lo-pillars .lo-pillar:nth-child(3) { animation-delay: -5.4s; }\n@keyframes loBreathDark { 0%,100% { transform: translateY(0); box-shadow: 0 2px 4px rgba(0,0,0,.3); border-color: rgba(255,107,0,.18); } 50% { transform: translateY(-3px); box-shadow: 0 18px 30px rgba(255,107,0,.25); border-color: rgba(255,107,0,.5); } }\n@keyframes loBreathOrange { 0%,100% { transform: translateY(0); box-shadow: 0 2px 4px rgba(255,107,0,.08); border-color: rgba(255,107,0,.2); } 50% { transform: translateY(-3px); box-shadow: 0 18px 30px rgba(255,107,0,.25); border-color: rgba(255,107,0,.5); } }\n.lo-pillar-num { width: 28px; height: 28px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 900; color: #fff; flex-shrink: 0; }\n.lo-pillar-num-light { background: linear-gradient(135deg, #FB923C, #FF6B00); box-shadow: 0 4px 10px rgba(255,107,0,.45), inset 0 1px 0 rgba(255,255,255,.35); }\n.lo-pillar-num-orange { background: linear-gradient(135deg, #FF6B00, #FB923C); box-shadow: 0 4px 10px rgba(255,107,0,.45), inset 0 1px 0 rgba(255,255,255,.4); }\n.lo-flow { position: relative; z-index: 2; display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 18px 6px 22px; margin-bottom: 24px; }\n.lo-flow::before { content: ''; position: absolute; left: 14%; right: 14%; top: 42px; height: 2px; background: repeating-linear-gradient(90deg, rgba(255,107,0,.35) 0 6px, transparent 6px 12px); }\n.lo-flow::after { content: ''; position: absolute; top: 36px; width: 14px; height: 14px; border-radius: 50%; background: #FF6B00; box-shadow: 0 0 12px #FF6B00, 0 0 24px rgba(255,107,0,.5); animation: loFlowPulse 3.5s ease-in-out infinite; }\n@keyframes loFlowPulse { 0% { left: 14%; opacity: 0; transform: translateX(-50%) scale(.6); } 10% { opacity: 1; transform: translateX(-50%) scale(1); } 90% { opacity: 1; transform: translateX(-50%) scale(1); } 100% { left: 86%; opacity: 0; transform: translateX(-50%) scale(.6); } }\n.lo-step { position: relative; z-index: 2; flex: 1; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; }\n.lo-step-ic-wrap { position: relative; width: 64px; height: 64px; perspective: 600px; }\n.lo-step-ic-glow { position: absolute; inset: -10px; border-radius: 50%; background: radial-gradient(circle, rgba(255,107,0,.35) 0%, transparent 65%); filter: blur(14px); animation: loIcGlow 3s ease-in-out infinite alternate; }\n.lo-step:nth-child(2) .lo-step-ic-glow { animation-delay: -1s; }\n.lo-step:nth-child(3) .lo-step-ic-glow { animation-delay: -2s; }\n.lo-step-ic { position: relative; width: 100%; height: 100%; border-radius: 18px; background: linear-gradient(135deg, #FF6B00 0%, #C2410C 100%); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 2px rgba(255,138,76,.5), 0 14px 26px rgba(124,45,18,.35), inset 0 2px 0 rgba(255,255,255,.3); transform-style: preserve-3d; animation: loIcFloat 5s ease-in-out infinite; }\n.lo-step:nth-child(2) .lo-step-ic { animation-delay: -1.7s; }\n.lo-step:nth-child(3) .lo-step-ic { animation-delay: -3.3s; }\n@keyframes loIcFloat { 0%,100% { transform: rotateY(-14deg) rotateX(8deg) translateY(0); } 50% { transform: rotateY(14deg) rotateX(-4deg) translateY(-3px); } }\n.lo-step-ic svg { width: 28px; height: 28px; }\n.lo-step-num { position: absolute; top: -6px; right: -6px; width: 22px; height: 22px; border-radius: 50%; background: #fff; color: #FF6B00; font-size: 11px; font-weight: 900; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,.15); z-index: 3; }\n.lo-step-label { font-size: 11px; font-weight: 800; color: #7C2D12; letter-spacing: -.1px; line-height: 1.25; max-width: 100px; }\n.lo-step-sub { font-size: 10px; color: #9A3412; opacity: .8; line-height: 1.3; max-width: 110px; }\n@media (prefers-reduced-motion: reduce) { .lo-shield, .lo-shield-ring, .lo-shield-ring2, .lo-shield-glow, .lo-harass-orb, .lo-tow::before, .lo-tow::after, .lo-step-ic, .lo-step-ic-glow, .lo-flow::after, .lo-pillar, .lo-pulse, .lo-harass::before { animation: none !important; } }\n";

// Backup
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(path.join(BACKUP_DIR, 'public'), { recursive: true });
fs.copyFileSync(TARGET, path.join(BACKUP_DIR, TARGET));

// Normalize CRLF
const wasCRLF = text.indexOf('\r\n') !== -1;
text = text.replace(/\r\n/g, '\n');

// ============================================================================
// 1) Strip the entire ZONE between solution section close and HOW IT WORKS.
//    We identify the zone by walking back from HOW IT WORKS to the earliest
//    objection marker  v1 or any v2 variant. If none found, zone is empty
//    (clean file) and we just insert before HOW IT WORKS.
// ============================================================================
const HOW = '<!-- HOW IT WORKS';
const howIdx = text.indexOf(HOW);
if (howIdx < 0) { throw new Error('HOW IT WORKS anchor not found'); }

const v1m   = text.lastIndexOf('<!-- TMC_LAND_OBJECTIONS:',          howIdx);
const v2m   = text.lastIndexOf('<!-- TMC_LAND_OBJECTIONS_V2',         howIdx);
let earliestMarker = Infinity;
if (v1m  >= 0) earliestMarker = Math.min(earliestMarker, v1m);
if (v2m  >= 0) earliestMarker = Math.min(earliestMarker, v2m);

let zoneStart;
if (earliestMarker !== Infinity) {
  // Walk back to also include any whitespace + chev before the marker
  zoneStart = earliestMarker;
  const before = text.slice(0, zoneStart);
  const chevMatch = before.match(/<div class="chev"><\/div>\s*$/);
  if (chevMatch) zoneStart = chevMatch.index;
} else {
  // No prior objection sections  zone starts right at HOW IT WORKS
  zoneStart = howIdx;
  const before = text.slice(0, zoneStart);
  const chevMatch = before.match(/<div class="chev"><\/div>\s*$/);
  if (chevMatch) zoneStart = chevMatch.index;
}

// Walk back over whitespace
while (zoneStart > 0 && /\s/.test(text[zoneStart - 1])) zoneStart--;

const beforeZone = text.slice(0, zoneStart);
const afterZone  = text.slice(howIdx);

// 2) Build new zone content
const newZone = '\n\n<div class="chev"></div>\n\n' + V2_HTML + '\n<div class="chev"></div>\n\n';
text = beforeZone + newZone + afterZone;

// ============================================================================
// 3) Strip any prior v2 CSS block from /* TMC_LAND_OBJECTIONS_V2 to
//    /* HOW IT WORKS */ (exclusive). Then insert fresh V2_CSS before that.
// ============================================================================
const cssEndMarker = '/* HOW IT WORKS */';
const cssEndIdx = text.indexOf(cssEndMarker);
if (cssEndIdx < 0) { throw new Error('CSS HOW IT WORKS anchor not found'); }

const cssStartMatch = text.slice(0, cssEndIdx).match(/\/\* TMC_LAND_OBJECTIONS_V2[\s\S]*$/);
if (cssStartMatch) {
  // Existing v2 CSS present  strip it
  const cssStartIdx = cssStartMatch.index;
  text = text.slice(0, cssStartIdx) + V2_CSS + text.slice(cssEndIdx);
} else {
  // No prior v2 CSS  just inject before HOW IT WORKS comment
  text = text.slice(0, cssEndIdx) + V2_CSS + text.slice(cssEndIdx);
}

// 4) Defensive: clean any stray escaped apostrophes
text = text.replace(/\\'/g, "'");

// Restore CRLF if original
if (wasCRLF) text = text.replace(/\n/g, '\r\n');

fs.writeFileSync(TARGET, text, 'utf8');
console.log(TARGET + ': hotfix applied  v1 removed, harassment section rethemed orange');
console.log('Backup saved in: ' + BACKUP_DIR + '/');
console.log('');
console.log('NEXT STEPS:');
console.log('  git add -A');
console.log('  git commit -m "Landing objection sections hotfix: remove duplicates, orange theme"');
console.log('  git push');
