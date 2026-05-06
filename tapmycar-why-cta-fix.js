// ═══════════════════════════════════════════════════════════════
// TapMyCar — why.html CTA fix
// ═══════════════════════════════════════════════════════════════
// Changes the bottom CTA box on why.html so it:
//   - Promotes the Standard plan (the paid one) as the main pitch
//   - Mentions free signup as a smaller side option
//   - Sends users to /pricing.html (where they see ALL plans:
//     free eTag, Standard, Premium) instead of /register.html
//
// Run from project root:  node tapmycar-why-cta-fix.js
//
// Touches only public/why.html. Idempotent (safe to re-run).
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');
const TARGET = path.join(PUBLIC, 'why.html');

if (!fs.existsSync(TARGET)) {
  console.error('ERROR: public/why.html not found.');
  console.error('Run this from your project root.');
  process.exit(1);
}

// ─── BACKUP ──────────────────────────────────────────────────
const now = new Date();
const stamp = now.getFullYear() + '-' +
  String(now.getMonth()+1).padStart(2,'0') + '-' +
  String(now.getDate()).padStart(2,'0') + '-' +
  String(now.getHours()).padStart(2,'0') +
  String(now.getMinutes()).padStart(2,'0');
const BACKUP = path.join(ROOT, 'backup-why-cta-' + stamp);
fs.mkdirSync(BACKUP, { recursive: true });
fs.copyFileSync(TARGET, path.join(BACKUP, 'why.html'));
console.log('  Backup: ' + path.relative(ROOT, BACKUP));

// ─── REPLACE THE CTA BLOCK ────────────────────────────────────
let html = fs.readFileSync(TARGET, 'utf8');

// The OLD CTA block to replace
const oldCta = `<div class="cta-box">
    <h3>It's a precaution.</h3>
    <p>Like insurance. Like a dashcam. Like locking your doors. You don't wait for something bad to happen — you prepare for it.</p>
    <a href="/register.html" class="cta-btn">Get your free eTag →</a>
  </div>
  <div style="text-align:center;font-size:12px;color:#6B7280;margin-bottom:16px">Free to start · Takes 2 minutes · No credit card needed</div>`;

// The NEW CTA block — promotes Standard, mentions free, button goes to pricing
const newCta = `<div class="cta-box">
    <h3>It's a precaution.</h3>
    <p>Like insurance. Like a dashcam. Like locking your doors. You don't wait for something bad to happen — you prepare for it.</p>
    <div style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25);border-radius:12px;padding:12px 14px;margin-bottom:14px;text-align:left;backdrop-filter:blur(8px)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="background:#fff;color:#FF6B00;font-size:9px;font-weight:800;padding:2px 8px;border-radius:99px;letter-spacing:.04em">RECOMMENDED</span>
        <span style="font-size:14px;font-weight:800;color:#fff">Standard plan</span>
      </div>
      <div style="font-size:11px;color:rgba(255,255,255,.85);line-height:1.5">Physical NFC + QR sticker shipped to your door · masked calling · scan-location tracking · SMS alerts</div>
    </div>
    <a href="/pricing.html" class="cta-btn">See all plans →</a>
  </div>
  <div style="text-align:center;font-size:12px;color:#6B7280;margin-bottom:16px">Standard from $9.99 · or <a href="/register.html" style="color:#FF6B00;text-decoration:none;font-weight:600">sign up free</a> for a digital eTag · No credit card to start</div>`;

if (html.indexOf('Get your free eTag') === -1 && html.indexOf('See all plans') !== -1) {
  console.log('  Already patched — no changes made');
} else if (html.indexOf(oldCta) === -1) {
  // Old CTA block didn't match exactly — try a more lenient regex
  const fallbackRegex = /<div class="cta-box">[\s\S]*?<a href="\/register\.html" class="cta-btn">Get your free eTag[\s\S]*?<\/a>\s*<\/div>\s*<div[^>]*>Free to start[^<]*<\/div>/;
  if (fallbackRegex.test(html)) {
    html = html.replace(fallbackRegex, newCta);
    fs.writeFileSync(TARGET, html, 'utf8');
    console.log('  Patched why.html (used fallback regex)');
  } else {
    console.error('  ERROR: Could not find the CTA block to replace.');
    console.error('  Your why.html may have been modified. Check public/why.html');
    console.error('  and look for the "Get your free eTag" CTA block.');
    process.exit(1);
  }
} else {
  html = html.replace(oldCta, newCta);
  fs.writeFileSync(TARGET, html, 'utf8');
  console.log('  Patched why.html (exact match)');
}

console.log('\n═══════════════════════════════════════════════');
console.log('  WHY.HTML CTA FIX COMPLETE');
console.log('═══════════════════════════════════════════════');
console.log('  Backup: ' + path.relative(ROOT, BACKUP));
console.log('');
console.log('Changes:');
console.log('  ✓ Headline still "It is a precaution." (unchanged)');
console.log('  ✓ Added "RECOMMENDED — Standard plan" highlight box');
console.log('    inside the CTA, with feature bullets');
console.log('  ✓ Main button now reads "See all plans →"');
console.log('    and links to /pricing.html (instead of /register.html)');
console.log('  ✓ Sub-text mentions Standard from $9.99, plus a small');
console.log('    "sign up free" link to /register.html for the eTag');
console.log('');
console.log('Test: open public/why.html, scroll to the bottom, you');
console.log('should see the Standard plan callout inside the orange');
console.log('CTA box and the "See all plans" button.');
